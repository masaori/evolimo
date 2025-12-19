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
mod _gen;

use recorder::{EvoConfig, EvoHeader, EvoRecorder};

/// How often to flush the output file during an infinite run.
const FLUSH_INTERVAL_FRAMES: u64 = 60;

#[derive(Debug, Parser)]
#[command(name = "evolimo-simulator")]
struct Args {
    /// Stop after this many simulation frames. If omitted, runs until Ctrl+C.
    #[arg(long)]
    max_sim_frames: Option<u64>,

    /// Definition to use
    #[arg(long, default_value = "universal_gravitation")]
    def: String,
}

fn env_or_default_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(default)
}

#[cfg(feature = "cuda")]
fn select_device() -> Device {
    Device::cuda_if_available(0).unwrap_or_else(|_| Device::Cpu)
}

#[cfg(all(feature = "metal", not(feature = "cuda")))]
fn select_device() -> Device {
    Device::new_metal(0).unwrap_or(Device::Cpu)
}

#[cfg(all(not(feature = "cuda"), not(feature = "metal")))]
fn select_device() -> Device {
    Device::Cpu
}

macro_rules! run_simulation {
    ($module:path) => {
        {
            use $module as def;
            use def::phenotype::PhenotypeEngine;
            use def::dynamics::{update_dynamics, STATE_DIMS, STATE_VARS, N_AGENTS, GENE_LEN, HIDDEN_LEN, init_state};
            use def::phenotype::init_genes;

            // Access args from the outer scope
            let args = Args::parse();

            println!("🧬 Evolimo - Evolution Simulator");
            println!("================================\n");

            let device = select_device();
            println!("📍 Device: {:?}\n", device);

            let n_agents = env_or_default_usize("EVO_N_AGENTS", N_AGENTS);

            // Initialize phenotype engine
            let varmap = candle_nn::VarMap::new();
            let vs = VarBuilder::from_varmap(&varmap, candle_core::DType::F32, &device);
            let phenotype_engine = PhenotypeEngine::new(vs, GENE_LEN, HIDDEN_LEN)?;

            // Initialize agents
            let genes = init_genes(n_agents, GENE_LEN, &device)?;
            let mut state = init_state(n_agents, &device)?;

            println!("🔧 Initialized {} agents", n_agents);
            println!("   Gene length: {}", GENE_LEN);
            println!("   State variables: {}\n", STATE_DIMS);

            // A. Phenotype expression (Genes -> Parameters)
            let params = phenotype_engine.forward(&genes)?;

            let header = EvoHeader::new(EvoConfig {
                n_agents,
                state_dims: STATE_DIMS,
                state_labels: STATE_VARS.iter().map(|s| (*s).to_string()).collect(),
            });

            let output_path = format!("output/{}.evo", args.def);
            // Ensure output directory exists
            if let Some(parent) = std::path::Path::new(&output_path).parent() {
                std::fs::create_dir_all(parent)?;
            }

            let mut recorder = EvoRecorder::create(&output_path, header)?;
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

                // B. Internal dynamics update (State + Parameters -> New State)
                let new_state = update_dynamics(&state, &params.physics, &params.attributes)?;
                state = new_state;
                recorder.write_frame(&state)?;
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
                    let elapsed = last_report_time.elapsed().as_secs_f64();
                    let fps = frames_since_last_report as f64 / elapsed;
                    println!(
                        "  Sim frame {}: FPS = {:.1}",
                        sim_frame, fps
                    );

                    last_report_time = Instant::now();
                    frames_since_last_report = 0;
                }
            }
        }
    }
}

fn main() -> Result<()> {
    let args = Args::parse();
    crate::with_definition!(args.def, run_simulation)
}
