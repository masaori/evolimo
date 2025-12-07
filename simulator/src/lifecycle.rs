/**
 * Generation management and lifecycle logic
 */

use candle_core::{Result, Tensor};

#[allow(dead_code)]
pub struct Generation {
    pub number: usize,
    pub agents: Tensor,      // Genotypes
    pub state: Tensor,       // Current state (position, velocity, energy, etc.)
    pub fitness: Vec<f32>,   // Fitness scores
}

impl Generation {
    #[allow(dead_code)]
    pub fn new(number: usize, agents: Tensor, state: Tensor) -> Self {
        let n_agents = agents.dims()[0];
        Self {
            number,
            agents,
            state,
            fitness: vec![0.0; n_agents],
        }
    }

    /// Calculate fitness based on survival time and energy
    #[allow(dead_code)]
    pub fn calculate_fitness(&mut self) -> Result<()> {
        // Simple fitness: energy remaining + survival bonus
        let energy_vals = self.state.narrow(1, 2, 1)?.to_vec2::<f32>()?;
        
        for (i, energy_row) in energy_vals.iter().enumerate() {
            self.fitness[i] = energy_row[0].max(0.0);
        }
        
        Ok(())
    }

    /// Select parents for next generation using tournament selection
    #[allow(dead_code)]
    pub fn select_parents(&self, n_parents: usize) -> Vec<usize> {
        use std::collections::HashSet;
        let mut rng = fastrand::Rng::new();
        let mut parents = Vec::new();
        let mut selected = HashSet::new();
        let tournament_size = 3;

        while parents.len() < n_parents {
            // Tournament selection: pick best from random sample
            let mut best_idx = rng.usize(0..self.fitness.len());
            let mut best_fitness = self.fitness[best_idx];

            for _ in 0..tournament_size {
                let idx = rng.usize(0..self.fitness.len());
                if self.fitness[idx] > best_fitness {
                    best_idx = idx;
                    best_fitness = self.fitness[idx];
                }
            }

            // Only add if not already selected (prevent duplicates)
            if !selected.contains(&best_idx) {
                parents.push(best_idx);
                selected.insert(best_idx);
            }
        }

        parents
    }
}

// Simple RNG for demonstration (in real implementation, use rand crate)
mod fastrand {
    pub struct Rng {
        state: u64,
    }

    impl Rng {
        pub fn new() -> Self {
            Self {
                state: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos() as u64,
            }
        }

        pub fn usize(&mut self, range: std::ops::Range<usize>) -> usize {
            let val = self.next_u64();
            range.start + (val as usize % (range.end - range.start))
        }

        fn next_u64(&mut self) -> u64 {
            self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
            self.state
        }
    }
}
