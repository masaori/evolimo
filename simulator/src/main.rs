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

fn main() -> Result<()> {
    println!("🧬 Evolimo - Evolution Simulator");
    println!("================================\n");

    let device = Device::Cpu;
    println!("📍 Device: {:?}\n", device);

    // Configuration
    let n_agents = 1000000;
    let gene_len = 32;
    let hidden_len = 64;
    let state_dims = 3usize;
    let save_interval: u64 = 10;
    let max_frames: u64 = 10;

    // Initialize phenotype engine
    let varmap = candle_nn::VarMap::new();
    let vs = VarBuilder::from_varmap(&varmap, candle_core::DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(vs, gene_len, hidden_len)?;

    // Initialize agents
    let genes = Tensor::randn(0f32, 1f32, (n_agents, gene_len), &device)?;
    let mut state = Tensor::zeros((n_agents, state_dims), candle_core::DType::F32, &device)?; // [pos_x, vel_x, energy]

    println!("🔧 Initialized {} agents", n_agents);
    println!("   Gene length: {}", gene_len);
    println!("   State variables: 3 (pos_x, vel_x, energy)\n");

    // A. Phenotype expression (Genes -> Parameters)
    // Since genes are static during simulation, we can calculate this once.
    let params = phenotype_engine.forward(&genes)?;

    let header = EvoHeader::new(
        EvoConfig {
            n_agents,
            state_dims,
            state_labels: vec![
                "pos_x".to_string(),
                "vel_x".to_string(),
                "energy".to_string(),
            ],
            dt: 0.1,
        },
        PlaybackMeta {
            total_frames: max_frames as usize,
            save_interval,
        },
    );

    let output_path = "sim_output.evo";
    let mut recorder = EvoRecorder::create(output_path, header)?;
    println!("💾 Recording frames to {output_path} (every {save_interval} steps)\n");

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

        if step % save_interval == 0 {
            recorder.write_frame(&state)?;

            if recorder.frames_written() as u64 >= max_frames {
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
