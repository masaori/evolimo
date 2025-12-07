// Generated modules
#[allow(dead_code)]
mod gen_phenotype {
    include!(concat!(env!("OUT_DIR"), "/_gen_phenotype.rs"));
}

#[allow(dead_code)]
mod gen_physics {
    include!(concat!(env!("OUT_DIR"), "/_gen_physics.rs"));
}

pub use gen_phenotype::{PhenotypeEngine, PhenotypeOutput};
pub use gen_physics::update_physics;

pub mod lifecycle;
