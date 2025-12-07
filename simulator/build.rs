use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;
use serde::Deserialize;

#[derive(Deserialize)]
struct ConfigIR {
    state_vars: Vec<String>,
    groups: HashMap<String, GroupConfig>,
    operations: Vec<Operation>,
}

#[derive(Deserialize)]
struct GroupConfig {
    activation: String,
    params: Vec<String>,
}

#[derive(Deserialize)]
struct Operation {
    target: String,
    op: String,
    args: Vec<String>,
}

fn main() {
    // Trigger rebuild when JSON changes
    println!("cargo:rerun-if-changed=../domain-model/_gen/physics_ir.json");
    
    let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR not set");
    let json_path = Path::new("../domain-model/_gen/physics_ir.json");
    
    // Check if JSON exists
    if !json_path.exists() {
        eprintln!("WARNING: physics_ir.json not found. Run 'npm run compile' in domain-model/ first.");
        eprintln!("Generating stub files...");
        generate_stubs(&out_dir);
        return;
    }
    
    let json_str = fs::read_to_string(json_path).expect("Failed to read IR JSON");
    let ir: ConfigIR = serde_json::from_str(&json_str).expect("Invalid JSON format");

    generate_phenotype(&ir, &out_dir);
    generate_physics(&ir, &out_dir);
    
    println!("Code generation completed successfully");
}

fn generate_stubs(out_dir: &std::ffi::OsStr) {
    let stub_phenotype = r#"
pub struct PhenotypeOutput {}
pub struct PhenotypeEngine {}
impl PhenotypeEngine {
    pub fn new() -> Self { Self {} }
    pub fn forward(&self) -> PhenotypeOutput { PhenotypeOutput {} }
}
"#;
    
    let stub_physics = r#"
pub fn update_physics() -> Result<(), String> { Ok(()) }
"#;
    
    fs::write(Path::new(out_dir).join("_gen_phenotype.rs"), stub_phenotype).unwrap();
    fs::write(Path::new(out_dir).join("_gen_physics.rs"), stub_physics).unwrap();
}

fn generate_phenotype(ir: &ConfigIR, out_dir: &std::ffi::OsStr) {
    let mut code = String::new();
    
    // Imports
    code.push_str("use candle_core::{Tensor, Result, Module};\n");
    code.push_str("use candle_nn::{Linear, VarBuilder, linear, Sequential, seq};\n\n");

    // Output structure
    code.push_str("#[allow(dead_code)]\n");
    code.push_str("pub struct PhenotypeOutput {\n");
    for name in ir.groups.keys() {
        code.push_str(&format!("    pub {}: Tensor,\n", name));
    }
    code.push_str("}\n\n");

    // Engine structure
    code.push_str("#[allow(dead_code)]\n");
    code.push_str("pub struct PhenotypeEngine {\n");
    code.push_str("    base_net: Sequential,\n");
    for name in ir.groups.keys() {
        code.push_str(&format!("    head_{}: Linear,\n", name));
    }
    code.push_str("}\n\n");

    // Implementation
    code.push_str("impl PhenotypeEngine {\n");
    
    // Constructor
    code.push_str("    #[allow(dead_code)]\n");
    code.push_str("    pub fn new(vs: VarBuilder, input_dim: usize, hidden_dim: usize) -> Result<Self> {\n");
    code.push_str("        let base_net = seq()\n");
    code.push_str("            .add(linear(input_dim, hidden_dim, vs.pp(\"base1\"))?)\n");
    code.push_str("            .add(candle_nn::Activation::Relu);\n\n");
    
    for (name, data) in &ir.groups {
        let size = data.params.len();
        code.push_str(&format!(
            "        let head_{} = linear(hidden_dim, {}, vs.pp(\"head_{}\"))?;\n",
            name, size, name
        ));
    }
    
    code.push_str("\n        Ok(Self {\n");
    code.push_str("            base_net,\n");
    for name in ir.groups.keys() {
        code.push_str(&format!("            head_{},\n", name));
    }
    code.push_str("        })\n");
    code.push_str("    }\n\n");

    // Forward pass
    code.push_str("    #[allow(dead_code)]\n");
    code.push_str("    pub fn forward(&self, genes: &Tensor) -> Result<PhenotypeOutput> {\n");
    code.push_str("        let latent = self.base_net.forward(genes)?;\n\n");
    
    for (name, data) in &ir.groups {
        code.push_str(&format!("        let raw_{} = self.head_{}.forward(&latent)?;\n", name, name));
        
        match data.activation.as_str() {
            "softmax" => {
                code.push_str(&format!("        let val_{} = candle_nn::ops::softmax(&raw_{}, 1)?;\n", name, name));
            },
            "tanh" => {
                code.push_str(&format!("        let val_{} = raw_{}.tanh()?;\n", name, name));
            },
            "sigmoid" => {
                code.push_str(&format!("        let val_{} = candle_nn::ops::sigmoid(&raw_{})?;\n", name, name));
            },
            _ => {
                code.push_str(&format!("        let val_{} = raw_{};\n", name, name));
            }
        }
    }
    
    code.push_str("\n        Ok(PhenotypeOutput {\n");
    for name in ir.groups.keys() {
        code.push_str(&format!("            {}: val_{},\n", name, name));
    }
    code.push_str("        })\n");
    code.push_str("    }\n");
    code.push_str("}\n");

    fs::write(Path::new(out_dir).join("_gen_phenotype.rs"), code).unwrap();
}

fn generate_physics(ir: &ConfigIR, out_dir: &std::ffi::OsStr) {
    let mut code = String::new();
    
    code.push_str("use candle_core::{Tensor, Result};\n\n");
    code.push_str("#[allow(dead_code, unused_variables)]\n");
    
    // Function signature
    let mut args = vec!["state: &Tensor".to_string()];
    for name in ir.groups.keys() {
        args.push(format!("p_{}: &Tensor", name));
    }
    code.push_str(&format!("pub fn update_physics({}) -> Result<Tensor> {{\n", args.join(", ")));

    // Extract state variables
    code.push_str("    // Extract state variables\n");
    for (i, var) in ir.state_vars.iter().enumerate() {
        code.push_str(&format!("    let s_{} = state.narrow(1, {}, 1)?;\n", var, i));
    }
    code.push_str("\n");

    // Extract parameters by group
    code.push_str("    // Extract parameters by group\n");
    for (g_name, g_data) in &ir.groups {
        for (i, p_name) in g_data.params.iter().enumerate() {
            code.push_str(&format!(
                "    let p_{} = p_{}.narrow(1, {}, 1)?;\n",
                p_name, g_name, i
            ));
        }
    }
    code.push_str("\n");

    // Generate operations
    code.push_str("    // Apply operations\n");
    for op in &ir.operations {
        let expr = match op.op.as_str() {
            "const" => {
                // Create a scalar constant that will be broadcast in operations
                format!("Tensor::from_slice(&[{}f32], 1, state.device())?", op.args[0])
            },
            "add" => format!("{}.broadcast_add(&{})?", op.args[0], op.args[1]),
            "sub" => format!("{}.broadcast_sub(&{})?", op.args[0], op.args[1]),
            "mul" => format!("{}.broadcast_mul(&{})?", op.args[0], op.args[1]),
            "div" => format!("{}.broadcast_div(&{})?", op.args[0], op.args[1]),
            "relu" => format!("{}.relu()?", op.args[0]),
            "assign" => format!("{}.clone()", op.args[0]),
            _ => format!("{}.clone()", op.args[0]),
        };
        code.push_str(&format!("    let {} = {};\n", op.target, expr));
    }
    code.push_str("\n");

    // Concatenate results
    code.push_str("    // Concatenate updated state variables\n");
    code.push_str("    let result = Tensor::cat(&[\n");
    for var in &ir.state_vars {
        let final_var = format!("s_{}_next", var);
        code.push_str(&format!("        &{},\n", final_var));
    }
    code.push_str("    ], 1)?;\n\n");
    code.push_str("    Ok(result)\n");
    code.push_str("}\n");

    fs::write(Path::new(out_dir).join("_gen_physics.rs"), code).unwrap();
}
