use anyhow::Result;
use candle_core::{Device, DType, Tensor};
use candle_nn::VarBuilder;

use evolimo_simulator::{PhenotypeEngine, update_physics, lifecycle::Generation};

fn main() -> Result<()> {
    println!("=== Evolimo Simulator ===\n");

    // Device selection
    let device = match Device::cuda_if_available(0) {
        Ok(d) => {
            println!("Using device: CUDA");
            d
        }
        Err(_) => {
            println!("Using device: CPU");
            Device::Cpu
        }
    };

    // Simulation parameters
    let n_agents = 100;
    let gene_len = 32;
    let hidden_len = 64;
    let n_steps = 100;
    let n_generations = 5;

    println!("Configuration:");
    println!("  Agents: {}", n_agents);
    println!("  Gene length: {}", gene_len);
    println!("  Hidden layer: {}", hidden_len);
    println!("  Steps per generation: {}", n_steps);
    println!("  Generations: {}", n_generations);
    println!();

    // Initialize phenotype engine
    let varmap = candle_nn::VarMap::new();
    let vs = VarBuilder::from_varmap(&varmap, DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(vs, gene_len, hidden_len)?;

    // Initialize population with random genes
    let mut genes = Tensor::randn(0f32, 1f32, (n_agents, gene_len), &device)?;

    // Main evolution loop
    for gen_idx in 0..n_generations {
        println!("--- Generation {} ---", gen_idx + 1);

        // Initialize state: [pos_x, vel_x, energy]
        // Start with zero position/velocity, full energy
        let initial_state = Tensor::from_slice(
            &[0.0f32, 0.0f32, 100.0f32],
            (1, 3),
            &device,
        )?
        .broadcast_as((n_agents, 3))?
        .contiguous()?;

        let mut generation = Generation::new(gen_idx, genes.clone(), initial_state);

        // Run simulation for this generation
        for step in 0..n_steps {
            // 1. Gene expression: Convert genotype to phenotype parameters
            let params = phenotype_engine.forward(&genes)?;

            // 2. Physics update: Apply rules to update state
            let next_state = update_physics(
                &generation.state,
                &params.attributes,
                &params.physics,
            )?;

            generation.state = next_state;

            // Print progress every 20 steps
            if step % 20 == 0 {
                let energy = generation.state.narrow(1, 2, 1)?.mean_all()?.to_vec0::<f32>()?;
                println!("  Step {}: avg energy = {:.2}", step, energy);
            }

            // Check for extinction
            let energy = generation.state.narrow(1, 2, 1)?.to_vec2::<f32>()?;
            let alive_count = energy.iter().filter(|e| e[0] > 0.0).count();
            if alive_count == 0 {
                println!("  All agents died at step {}", step);
                break;
            }
        }

        // Calculate fitness
        generation.calculate_fitness()?;
        let avg_fitness = generation.fitness.iter().sum::<f32>() / generation.fitness.len() as f32;
        let max_fitness = generation.fitness.iter().fold(0.0f32, |a, &b| a.max(b));
        println!("  Avg fitness: {:.2}", avg_fitness);
        println!("  Max fitness: {:.2}", max_fitness);

        // Selection and reproduction for next generation
        if gen_idx < n_generations - 1 {
            let parent_indices = generation.select_parents(n_agents / 2);
            
            // Simple reproduction: copy parents and add mutations
            let mut next_genes = Vec::new();
            for &parent_idx in &parent_indices {
                // Add parent
                let parent_gene = genes.narrow(0, parent_idx, 1)?;
                next_genes.push(parent_gene.clone());
                
                // Add mutated offspring
                let mutation = Tensor::randn(0f32, 0.1f32, parent_gene.shape(), &device)?;
                let offspring = (parent_gene + mutation)?;
                next_genes.push(offspring);
            }
            
            genes = Tensor::cat(&next_genes.iter().collect::<Vec<_>>(), 0)?;
        }

        println!();
    }

    println!("=== Simulation Complete ===");
    Ok(())
}
