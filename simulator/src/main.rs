// Main entry point for evolution simulator

use anyhow::Result;
use candle_core::Device;
use candle_nn::VarBuilder;
use clap::Parser;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
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
use _gen::physics::{update_physics, update_physics_cpu, STATE_DIMS, STATE_VARS};
use recorder::{EvoConfig, EvoHeader, EvoRecorder};

/// Default agent count used when `EVO_N_AGENTS` is not provided. Tuned for local
/// development; override for large-scale runs.
const N_AGENTS: usize = 1_000;
/// Length of the gene vector per agent.
const GENE_LEN: usize = 32;
/// Hidden layer width for the phenotype network.
const HIDDEN_LEN: usize = 64;
/// Simulation timestep used for metadata only.
const DT: f32 = 0.1;
/// How often to flush the output file during an infinite run.
const FLUSH_INTERVAL_FRAMES: u64 = 60;

#[derive(Debug, Parser)]
#[command(name = "evolimo-simulator")]
struct Args {
    /// Stop after this many simulation frames. If omitted, runs until Ctrl+C.
    #[arg(long)]
    max_sim_frames: Option<u64>,

    /// Physics backend: "tensor" (default) or "cpu" (cell-list neighbor search).
    #[arg(long, default_value = "tensor")]
    physics_backend: String,
}

fn env_or_default_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
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
    let args = Args::parse();

    println!("🧬 Evolimo - Evolution Simulator");
    println!("================================\n");

    // CPU backend runs the simulation loop on CPU flat buffers; use CPU device.
    let device = if args.physics_backend == "cpu" {
        Device::Cpu
    } else {
        select_device()
    };
    println!("📍 Device: {:?}\n", device);

    let n_agents = env_or_default_usize("EVO_N_AGENTS", N_AGENTS);

    // Initialize phenotype engine
    let varmap = candle_nn::VarMap::new();
    let vs = VarBuilder::from_varmap(&varmap, candle_core::DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(vs, GENE_LEN, HIDDEN_LEN)?;

    // Initialize agents
    let genes = _gen::phenotype::init_genes(n_agents, GENE_LEN, &device)?;
    let mut state = _gen::physics::init_state(n_agents, &device)?;

    println!("🔧 Initialized {} agents", n_agents);
    println!("   Gene length: {}", GENE_LEN);
    println!("   State variables: {}\n", STATE_DIMS);

    // A. Phenotype expression (Genes -> Parameters)
    // Since genes are static during simulation, we can calculate this once.
    let params = phenotype_engine.forward(&genes)?;

    // CPU backend: flatten parameter tensors once.
    let (p_physics_flat, p_attributes_flat) = if args.physics_backend == "cpu" {
        let p_physics_2d: Vec<Vec<f32>> = params.physics.to_vec2()?;
        let p_attributes_2d: Vec<Vec<f32>> = params.attributes.to_vec2()?;
        let p_physics_flat: Vec<f32> = p_physics_2d.into_iter().flatten().collect();
        let p_attributes_flat: Vec<f32> = p_attributes_2d.into_iter().flatten().collect();
        (Some(p_physics_flat), Some(p_attributes_flat))
    } else {
        (None, None)
    };

    let header = EvoHeader::new(EvoConfig {
        n_agents,
        state_dims: STATE_DIMS,
        state_labels: STATE_VARS.iter().map(|s| (*s).to_string()).collect(),
        dt: DT,
    });

    let output_path = "sim_output.evo";
    let mut recorder = EvoRecorder::create(output_path, header)?;
    println!("💾 Recording sim frames to {output_path}\n");

    match args.max_sim_frames {
        Some(n) => println!("▶️  Running simulation until {n} sim frames are recorded...\n"),
        None => println!("▶️  Running simulation indefinitely (Ctrl+C to stop)...\n"),
    }

    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = Arc::clone(&stop);
        ctrlc::set_handler(move || {
            stop.store(true, Ordering::SeqCst);
        })?;
    }

    let mut sim_frame = 0u64;
    let mut last_report_time = Instant::now();
    let mut frames_since_last_report = 0u64;

    // CPU backend: keep state as a flat Vec<f32> and avoid per-frame Tensor conversions.
    let mut cpu_state_flat: Option<Vec<f32>> = if args.physics_backend == "cpu" {
        let state_2d: Vec<Vec<f32>> = state.to_vec2()?;
        Some(state_2d.into_iter().flatten().collect())
    } else {
        None
    };

    loop {
        if stop.load(Ordering::SeqCst) {
            recorder.flush()?;
            println!(
                "✅ Recorded {} sim frames. Output: {}",
                recorder.frames_written(),
                output_path
            );
            return Ok(());
        }

        if args.physics_backend == "cpu" {
            let old = cpu_state_flat.as_ref().expect("cpu_state_flat missing");
            let p_physics = p_physics_flat.as_ref().expect("p_physics_flat missing");
            let p_attributes = p_attributes_flat.as_ref().expect("p_attributes_flat missing");
            let new_flat = update_physics_cpu(old, p_physics, p_attributes)?;
            recorder.write_frame_f32(&new_flat)?;
            cpu_state_flat = Some(new_flat);
        } else {
            // B. Physics update (State + Parameters -> New State)
            let new_state = update_physics(&state, &params.physics, &params.attributes)?;
            // Explicitly drop old tensors to free GPU memory
            state = new_state;
            // Record every simulation frame.
            recorder.write_frame(&state)?;
        }
        sim_frame += 1;
        frames_since_last_report += 1;

        if let Some(max_sim_frames) = args.max_sim_frames {
            if sim_frame >= max_sim_frames {
                recorder.flush()?;
                println!(
                    "✅ Recorded {} sim frames. Output: {}",
                    recorder.frames_written(),
                    output_path
                );
                return Ok(());
            }
        }

        if sim_frame % FLUSH_INTERVAL_FRAMES == 0 {
            recorder.flush()?;
        }

        if sim_frame % 20 == 0 {
            let energy_sum: f32 = if args.physics_backend == "cpu" {
                // NOTE: energy index is 5 in current STATE_VARS ordering.
                cpu_state_flat
                    .as_ref()
                    .expect("cpu_state_flat missing")
                    .chunks_exact(STATE_DIMS)
                    .map(|row| row[5])
                    .sum()
            } else {
                // Force GPU synchronization by reading data to CPU
                state.narrow(1, 5, 1)?.sum_all()?.to_vec0()?
            };

            let elapsed = last_report_time.elapsed().as_secs_f64();
            let fps = frames_since_last_report as f64 / elapsed;
            println!(
                "  Sim frame {}: Total energy = {:.2}, FPS = {:.1}",
                sim_frame, energy_sum, fps
            );

            last_report_time = Instant::now();
            frames_since_last_report = 0;
        }
    }
}
