// Build script: Invokes code generators

use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../domain-model/_gen/");
    println!("cargo:rerun-if-changed=scripts/generators/generate-phenotype-physics.rs");

    let gen_dir = Path::new("../domain-model/_gen");
    if !gen_dir.exists() {
        println!("cargo:warning=domain-model/_gen not found. Skipping code generation.");
        return;
    }

    let mut definitions = Vec::new();

    for entry in fs::read_dir(gen_dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            let def_name = path.file_name().unwrap().to_str().unwrap().to_string();
            let json_path = path.join("dynamics_ir.json");
            if json_path.exists() {
                definitions.push(def_name.clone());

                let out_dir = format!("src/_gen/{}", def_name);

                // Run the phenotype/physics code generator
                let status = Command::new("cargo")
                    .args(&[
                        "run",
                        "--manifest-path",
                        "scripts/generators/Cargo.toml",
                        "--bin",
                        "generate-phenotype-physics",
                        "--",
                        json_path.to_str().unwrap(),
                        &out_dir,
                    ])
                    .status()
                    .expect("Failed to execute generator");

                if !status.success() {
                    eprintln!("⚠️  Code generation failed for {}", def_name);
                    std::process::exit(1);
                }
            }
        }
    }

    // Generate src/_gen/mod.rs
    let mut mod_rs = String::new();
    for def in &definitions {
        mod_rs.push_str(&format!("pub mod {};\n", def));
    }

    // Generate a macro to select the definition
    mod_rs.push_str("\n#[macro_export]\n");
    mod_rs.push_str("macro_rules! with_definition {\n");
    mod_rs.push_str("    ($name:expr, $callback:path) => {\n");
    mod_rs.push_str("        match $name.as_str() {\n");
    for def in &definitions {
        mod_rs.push_str(&format!("            \"{}\" => {{ $callback!(crate::_gen::{}) }},\n", def, def));
    }
    mod_rs.push_str("            _ => panic!(\"Unknown definition: {}\", $name),\n");
    mod_rs.push_str("        }\n");
    mod_rs.push_str("    }\n");
    mod_rs.push_str("}\n");

    fs::write("src/_gen/mod.rs", mod_rs).expect("Failed to write mod.rs");
}
