// Main entry point for evolution simulator

use anyhow::Result;
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use std::time::Instant;

mod _gen {
    pub mod phenotype {
        include!("_gen/phenotype.rs");
    }
    pub mod physics {
        include!("_gen/physics.rs");
    }
}

use _gen::phenotype::PhenotypeEngine;
use _gen::physics::update_physics;

fn main() -> Result<()> {
    println!("🧬 Evolimo - Evolution Simulator");
    println!("================================\n");

    // Device selection: uncomment one of the following
    // let device = Device::cuda_if_available(0)?; // CUDA (NVIDIA GPU) if available, otherwise CPU
    let device = Device::new_metal(0)?; // Metal (Apple Silicon GPU)
    // let device = Device::Cpu; // CPU only
    println!("📍 Device: {:?}\n", device);

    // Configuration
    let n_agents = 1000000;
    let gene_len = 32;
    let hidden_len = 64;

    // Initialize phenotype engine
    let varmap = candle_nn::VarMap::new();
    let vs = VarBuilder::from_varmap(&varmap, candle_core::DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(vs, gene_len, hidden_len)?;

    // Initialize agents
    let genes = Tensor::randn(0f32, 1f32, (n_agents, gene_len), &device)?;
    let mut state = Tensor::zeros((n_agents, 3), candle_core::DType::F32, &device)?; // [pos_x, vel_x, energy]

    println!("🔧 Initialized {} agents", n_agents);
    println!("   Gene length: {}", gene_len);
    println!("   State variables: 3 (pos_x, vel_x, energy)\n");

    // A. Phenotype expression (Genes -> Parameters)
    // Since genes are static during simulation, we can calculate this once.
    let params = phenotype_engine.forward(&genes)?;

    println!("▶️  Running simulation (Press Ctrl+C to stop)...\n");

    let mut step = 0u64;
    let mut last_report_time = Instant::now();
    let mut steps_since_last_report = 0u64;
    
    loop {
        // B. Physics update (State + Parameters -> New State)
        let new_state = update_physics(&state, &params.attributes, &params.physics)?;
        
        // Explicitly drop old tensors to free GPU memory
        state = new_state;

        // Progress report
        step += 1;
        steps_since_last_report += 1;
        
        if step % 20 == 0 {
            // Force GPU synchronization by reading data to CPU
            let energy_sum: f32 = state.narrow(1, 2, 1)?.sum_all()?.to_vec0()?;
            
            let elapsed = last_report_time.elapsed().as_secs_f64();
            let fps = steps_since_last_report as f64 / elapsed;
            println!(
                "  Step {}: Total energy = {:.2}, FPS = {:.1}",
                step, energy_sum, fps
            );
            
            last_report_time = Instant::now();
            steps_since_last_report = 0;
        }
    }
}
