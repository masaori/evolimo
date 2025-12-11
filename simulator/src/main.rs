// Main entry point for evolution simulator

use anyhow::Result;
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use std::time::Instant;

mod recorder;

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
use recorder::{EvoConfig, EvoHeader, EvoRecorder, PlaybackMeta};

/// Default agent count used when `EVO_N_AGENTS` is not provided. Tuned for local
/// development; override for large-scale runs.
const N_AGENTS: usize = 1_000;
/// Length of the gene vector per agent.
const GENE_LEN: usize = 32;
/// Hidden layer width for the phenotype network.
const HIDDEN_LEN: usize = 64;
/// Number of state variables stored per agent (pos_x, vel_x, energy).
const STATE_DIMS: usize = 3;
/// How many simulation steps to skip between frame saves.
const SAVE_INTERVAL: u64 = 10;
/// Maximum frames recorded in one run. Override `EVO_MAX_FRAMES` to change.
const MAX_FRAMES: u64 = 10;
/// Simulation timestep used for metadata only.
const DT: f32 = 0.1;

fn env_or_default_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(default)
}

fn env_or_default_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

#[cfg(feature = "cuda")]
/// Select the compute device. When built with the `cuda` feature, it will try to
/// use CUDA and fall back to CPU.
fn select_device() -> Device {
    Device::cuda_if_available(0).unwrap_or_else(|_| Device::Cpu)
}

#[cfg(all(feature = "metal", not(feature = "cuda")))]
/// Select the compute device. Metal is tried first, then CPU as a fallback.
fn select_device() -> Device {
    Device::new_metal(0).unwrap_or(Device::Cpu)
}

#[cfg(all(not(feature = "cuda"), not(feature = "metal")))]
/// Select the compute device. CUDA/Metal support is disabled; CPU is always used.
fn select_device() -> Device {
    Device::Cpu
}

fn main() -> Result<()> {
    println!("🧬 Evolimo - Evolution Simulator");
    println!("================================\n");

    let device = select_device();
    println!("📍 Device: {:?}\n", device);

    let n_agents = env_or_default_usize("EVO_N_AGENTS", N_AGENTS);
    let max_frames = env_or_default_u64("EVO_MAX_FRAMES", MAX_FRAMES);

    // Initialize phenotype engine
    let varmap = candle_nn::VarMap::new();
    let vs = VarBuilder::from_varmap(&varmap, candle_core::DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(vs, GENE_LEN, HIDDEN_LEN)?;

    // Initialize agents
    let genes = Tensor::randn(0f32, 1f32, (n_agents, GENE_LEN), &device)?;
    let mut state = Tensor::zeros((n_agents, STATE_DIMS), candle_core::DType::F32, &device)?; // [pos_x, vel_x, energy]

    println!("🔧 Initialized {} agents", n_agents);
    println!("   Gene length: {}", GENE_LEN);
    println!("   State variables: 3 (pos_x, vel_x, energy)\n");

    // A. Phenotype expression (Genes -> Parameters)
    // Since genes are static during simulation, we can calculate this once.
    let params = phenotype_engine.forward(&genes)?;

    debug_assert!(
        max_frames <= usize::MAX as u64,
        "EVO_MAX_FRAMES truncated on this platform"
    );
    let total_frames = max_frames as usize;
    let header = EvoHeader::new(
        EvoConfig {
            n_agents,
            state_dims: STATE_DIMS,
            state_labels: vec![
                "pos_x".to_string(),
                "vel_x".to_string(),
                "energy".to_string(),
            ],
            dt: DT,
        },
        PlaybackMeta {
            total_frames,
            save_interval: SAVE_INTERVAL,
        },
    );

    let output_path = "sim_output.evo";
    let mut recorder = EvoRecorder::create(output_path, header)?;
    println!("💾 Recording frames to {output_path} (every {SAVE_INTERVAL} steps)\n");

    println!(
        "▶️  Running simulation until {} frames are recorded...\n",
        max_frames
    );

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

        if step % SAVE_INTERVAL == 0 {
            recorder.write_frame(&state)?;

            if recorder.frames_written() >= max_frames {
                recorder.flush()?;
                println!(
                    "✅ Recorded {} frames. Output: {}",
                    recorder.frames_written(),
                    output_path
                );
                break;
            }
        }

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
