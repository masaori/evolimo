// Library root

#[allow(dead_code)]
mod _gen {
    pub mod phenotype {
        include!("_gen/phenotype.rs");
    }
    pub mod dynamics {
        include!("_gen/dynamics.rs");
    }
    pub mod physics {
        include!("_gen/physics.rs");
    }
}

pub use _gen::phenotype::*;

// Primary API
pub use _gen::dynamics::{init_state, update_dynamics, STATE_DIMS, STATE_VARS};

// Compatibility modules
pub use _gen::dynamics as dynamics;
pub use _gen::physics as physics;
