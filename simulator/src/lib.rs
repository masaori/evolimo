// Library root

#[allow(dead_code)]
mod _gen {
    pub mod phenotype {
        include!("_gen/phenotype.rs");
    }
    pub mod physics {
        include!("_gen/physics.rs");
    }
}

pub use _gen::phenotype::*;
pub use _gen::physics::*;
