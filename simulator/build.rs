// Build script: Invokes code generators

use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../domain-model/_gen/physics_ir.json");
    println!("cargo:rerun-if-changed=scripts/generators/generate-phenotype-physics.rs");

    // Run the phenotype/physics code generator
    let status = Command::new("cargo")
        .args(&[
            "run",
            "--manifest-path",
            "scripts/generators/Cargo.toml",
            "--bin",
            "generate-phenotype-physics",
        ])
        .status()
        .expect("Failed to execute generator");

    if !status.success() {
        eprintln!("⚠️  Code generation failed");
        std::process::exit(1);
    }
}
