use candle_core::{Result, Tensor};

#[derive(Debug, Clone)]
pub struct SpatialGrid {
    pub width: usize,
    pub height: usize,
    pub capacity: usize,
    pub cell_size: (f32, f32),
}

/// Maps particles to a fixed-capacity grid.
///
/// Returns a tuple:
/// 1. `grid_state`: [Height, Width, Capacity, StateDims]
/// 2. `grid_mask`: [Height, Width, Capacity, 1] (1.0 for valid particles, 0.0 for empty slots)
/// 3. `sort_indices`: [N_AGENTS] (Indices to map back to original order)
pub fn particles_to_grid(
    pos_x: &Tensor, // [N, 1]
    pos_y: &Tensor, // [N, 1]
    state: &Tensor, // [N, D]
    config: &SpatialGrid,
) -> Result<(Tensor, Tensor, Tensor)> {
    let n_agents = state.dim(0)?;
    let device = state.device();
    let (w, h) = (config.width as f32, config.height as f32);
    let (cw, ch) = (config.cell_size.0, config.cell_size.1);
    let cap = config.capacity as f32;

    // 1. Grid Coordinates (GPU)
    // pos / cell_size (use F32 for Metal compatibility)
    let gx = (pos_x / cw as f64)?.floor()?;
    let gy = (pos_y / ch as f64)?.floor()?;

    // Wrap (Torus) helper
    let wrap = |x: &Tensor, max: f32| -> Result<Tensor> {
        let max_t = Tensor::new(&[max], device)?;
        let div = x.broadcast_div(&max_t)?.floor()?;
        let sub = div.broadcast_mul(&max_t)?;
        x.broadcast_sub(&sub)
    };
    
    let gx = wrap(&gx, w)?;
    let gy = wrap(&gy, h)?;

    // 2. Cell Index
    // idx = gy * w + gx
    let w_t = Tensor::new(&[w], device)?;
    let cell_idx = gy.broadcast_mul(&w_t)?.broadcast_add(&gx)?;

    // 3. Slot Index (Hash based on Particle ID)
    // We use a simple modulo hash: slot = particle_id % capacity
    // This avoids CPU sync but allows collisions.
    // Collisions are handled by averaging the state (center of mass).
    let particle_ids = Tensor::arange(0u32, n_agents as u32, device)?
        .reshape((n_agents, 1))?
        .to_dtype(candle_core::DType::F32)?;
        
    let slot_idx = wrap(&particle_ids, cap)?; // particle_id % capacity

    // 4. Flat Index
    // flat = cell_idx * capacity + slot_idx
    let cap_t = Tensor::new(&[cap], device)?;
    let flat_idx = cell_idx.broadcast_mul(&cap_t)?.broadcast_add(&slot_idx)?;
    let flat_idx = flat_idx.flatten_all()?.to_dtype(candle_core::DType::U32)?;

    // 5. Scatter to Grid
    let total_slots = config.width * config.height * config.capacity;
    let state_dim = state.dim(1)?;
    
    // Initialize grid with zeros
    let mut grid_flat = Tensor::zeros((total_slots, state_dim), state.dtype(), device)?;
    
    // Accumulate state into grid slots
    // Ensure state is contiguous
    let state_cont = if state.is_contiguous() {
        state.clone()
    } else {
        state.contiguous()?
    };
    grid_flat = grid_flat.index_add(&flat_idx, &state_cont, 0)?;
    
    // 6. Mask (Count)
    let mut mask_flat = Tensor::zeros((total_slots, 1), state.dtype(), device)?;
    let ones = Tensor::ones((n_agents, 1), state.dtype(), device)?;
    mask_flat = mask_flat.index_add(&flat_idx, &ones, 0)?;
    
    // 7. Average colliding particles
    // Avoid division by zero
    let safe_mask = mask_flat.maximum(&Tensor::ones_like(&mask_flat)?)?;
    grid_flat = grid_flat.broadcast_div(&safe_mask)?;
    
    // Clamp mask to 0.0/1.0 for validity
    let valid_mask = mask_flat.minimum(&Tensor::ones_like(&mask_flat)?)?;
    
    // Reshape
    let grid = grid_flat.reshape((config.height, config.width, config.capacity, state_dim))?;
    let mask = valid_mask.reshape((config.height, config.width, config.capacity, 1))?;
    
    // Return flat_idx as target_indices for gathering later
    Ok((grid, mask, flat_idx))
}

/// Computes stencil (neighbor) interactions.
///
/// `op_func` is a closure that takes (center_grid, neighbor_grid) and returns forces/updates.
/// But since we are generating code, we might not pass a closure easily if we want to keep it simple.
/// Instead, this function will return the *shifted grids* so the main code can compute interactions?
/// Or better, we implement the loop here and take a callback?
///
/// In the generated code, the user defines the interaction logic.
/// The `stencil` op in IR likely wraps an expression.
///
/// If `stencil` op in IR is: `stencil(value=interaction_expr, range=1)`
/// The `interaction_expr` expects `center` and `neighbor` inputs?
///
/// Looking at the plan:
/// ```rust
/// fn compute_neighbor_forces(grid, range) {
///    for dy... for dx...
///       shifted = shift_grid(grid, dx, dy)
///       force = compute_pairwise(grid, shifted)
///       forces += force
/// }
/// ```
///
/// So we need a helper `shift_grid`.
/// And maybe a helper that orchestrates the loop if we can pass the compute function.
///
/// Since we are generating Rust code, we can generate the loop in the `dynamics.rs`.
/// But that increases code size.
///
/// Let's provide `shift_grid` helper.
pub fn shift_grid(
    grid: &Tensor, // [H, W, Cap, D]
    dx: i32,
    dy: i32,
) -> Result<Tensor> {
    // Implement roll with wrapping (Torus)
    // grid is 4D. We roll on dim 0 (H) and 1 (W).
    
    let (h, w) = (grid.dim(0)?, grid.dim(1)?);
    
    // Helper for 1D roll
    let roll_dim = |t: &Tensor, shift: i32, dim: usize, size: usize| -> Result<Tensor> {
        if shift == 0 {
            return Ok(t.clone());
        }
        let shift = shift.rem_euclid(size as i32) as usize;
        if shift == 0 {
            return Ok(t.clone());
        }
        // split at size - shift
        let split_idx = size - shift;
        
        let part1 = t.narrow(dim, 0, split_idx)?;
        let part2 = t.narrow(dim, split_idx, size - split_idx)?;
        Tensor::cat(&[&part2, &part1], dim)
    };
    
    let t = roll_dim(grid, dy, 0, h)?;
    let t = roll_dim(&t, dx, 1, w)?;
    Ok(t)
}

/// Maps grid values back to particles.
pub fn grid_to_particles(
    grid: &Tensor, // [H, W, Cap, D]
    target_indices: &Tensor, // [N]
) -> Result<Tensor> {
    let (h, w, cap, d) = grid.dims4()?;
    let grid_flat = grid.reshape((h * w * cap, d))?;
    
    // gather: result[i] = grid_flat[target_indices[i]]
    // candle's index_select works on dim 0.
    grid_flat.index_select(target_indices, 0)
}

/// Creates a padded grid with torus boundary conditions.
/// The padding copies the opposite edges to create seamless wrap-around.
/// Returns a grid of shape [H + 2*pad, W + 2*pad, Cap, D]
fn create_torus_padded_grid(grid: &Tensor, pad: usize) -> Result<Tensor> {
    let (h, w, _cap, _d) = grid.dims4()?;
    
    if pad == 0 {
        return Ok(grid.clone());
    }
    
    // Step 1: Pad height dimension (dim 0)
    // Top padding: last `pad` rows of grid
    // Bottom padding: first `pad` rows of grid
    let top_pad = grid.narrow(0, h - pad, pad)?;
    let bottom_pad = grid.narrow(0, 0, pad)?;
    let h_padded = Tensor::cat(&[&top_pad, grid, &bottom_pad], 0)?;
    
    // Step 2: Pad width dimension (dim 1) 
    // Left padding: last `pad` columns of h_padded
    // Right padding: first `pad` columns of h_padded
    let new_h = h + 2 * pad;
    let left_pad = h_padded.narrow(1, w - pad, pad)?;
    let right_pad = h_padded.narrow(1, 0, pad)?;
    let fully_padded = Tensor::cat(&[&left_pad, &h_padded, &right_pad], 1)?;
    
    debug_assert_eq!(fully_padded.dim(0)?, new_h);
    debug_assert_eq!(fully_padded.dim(1)?, w + 2 * pad);
    
    Ok(fully_padded)
}

pub fn solve_gravity_stencil(
    grid: &Tensor, // [H, W, Cap, D]
    range: i32,
) -> Result<Tensor> {
    let device = grid.device();
    let (h, w, cap, _d) = grid.dims4()?;
    let pad = range as usize;
    
    // Create padded grid ONCE (instead of 9 shift operations for range=1)
    let padded = create_torus_padded_grid(grid, pad)?;
    
    // Extract center components from original grid [H, W, Cap, 1]
    let g_pos_x = grid.narrow(3, 0, 1)?;
    let g_pos_y = grid.narrow(3, 1, 1)?;
    
    // Center (Receiver): [H, W, Cap, 1, 1] for broadcasting
    let c_pos_x = g_pos_x.unsqueeze(3)?;
    let c_pos_y = g_pos_y.unsqueeze(3)?;
    
    let mut acc_fx = Tensor::zeros((h, w, cap, 1), grid.dtype(), device)?;
    let mut acc_fy = Tensor::zeros((h, w, cap, 1), grid.dtype(), device)?;
    
    for dy in -range..=range {
        for dx in -range..=range {
            // Zero-copy view into padded grid (narrow returns a view, not a copy)
            let offset_y = (pad as i32 + dy) as usize;
            let offset_x = (pad as i32 + dx) as usize;
            let neighbor = padded
                .narrow(0, offset_y, h)?
                .narrow(1, offset_x, w)?;
            
            // Neighbor (Source): [H, W, Cap, D]
            let n_pos_x = neighbor.narrow(3, 0, 1)?;
            let n_pos_y = neighbor.narrow(3, 1, 1)?;
            let n_mass = neighbor.narrow(3, 4, 1)?;
            
            // Reshape for broadcast: [H, W, 1, Cap, 1]
            let n_pos_x = n_pos_x.unsqueeze(2)?;
            let n_pos_y = n_pos_y.unsqueeze(2)?;
            let n_mass = n_mass.unsqueeze(2)?;
            
            // Delta: [H, W, Cap, Cap]
            let dx_t = n_pos_x.broadcast_sub(&c_pos_x)?;
            let dy_t = n_pos_y.broadcast_sub(&c_pos_y)?;
            
            let d2 = dx_t.powf(2.0)?.broadcast_add(&dy_t.powf(2.0)?)?;
            let d2 = d2.broadcast_add(&Tensor::new(&[0.01f32], device)?)?; // Softening
            
            let inv_d2 = d2.powf(-1.0)?;
            let f_x = n_mass.broadcast_mul(&dx_t)?.broadcast_mul(&inv_d2)?;
            let f_y = n_mass.broadcast_mul(&dy_t)?.broadcast_mul(&inv_d2)?;
            
            // Sum over neighbor particles (dim 3)
            let f_x_sum = f_x.sum(3)?; // [H, W, Cap, 1]
            let f_y_sum = f_y.sum(3)?;
            
            acc_fx = acc_fx.add(&f_x_sum)?;
            acc_fy = acc_fy.add(&f_y_sum)?;
        }
    }
    
    // Construct result [H, W, Cap, D]
    // 0:pos_x, 1:pos_y, 2:vel_x, 3:vel_y, 4:size
    // We put forces into vel_x and vel_y slots. Others zero.
    let zeros = Tensor::zeros((h, w, cap, 1), grid.dtype(), device)?;
    
    Tensor::cat(&[&zeros, &zeros, &acc_fx, &acc_fy, &zeros], 3)
}
