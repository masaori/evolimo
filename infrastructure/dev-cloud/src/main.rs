use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_ec2::types::InstanceStateName;
use aws_sdk_ec2::Client;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cloud-control")]
#[command(about = "Control GPU development EC2 instance", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the EC2 instance
    Start {
        /// Instance ID from Terraform output
        #[arg(short, long)]
        instance_id: String,
    },
    /// Stop the EC2 instance
    Stop {
        /// Instance ID from Terraform output
        #[arg(short, long)]
        instance_id: String,
    },
    /// Check instance status
    Status {
        /// Instance ID from Terraform output
        #[arg(short, long)]
        instance_id: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let config = aws_config::defaults(BehaviorVersion::latest())
        .region("ap-northeast-1")
        .load()
        .await;
    let client = Client::new(&config);

    match cli.command {
        Commands::Start { instance_id } => {
            start_instance(&client, &instance_id).await?;
        }
        Commands::Stop { instance_id } => {
            stop_instance(&client, &instance_id).await?;
        }
        Commands::Status { instance_id } => {
            check_status(&client, &instance_id).await?;
        }
    }

    Ok(())
}

async fn start_instance(client: &Client, instance_id: &str) -> Result<()> {
    println!("🚀 Starting instance: {}", instance_id);

    client
        .start_instances()
        .instance_ids(instance_id)
        .send()
        .await
        .context("Failed to start instance")?;

    println!("✅ Start command sent successfully");
    println!("⏳ Waiting for instance to be running...");

    // Wait for instance to be running
    let waiter = client
        .wait_until_instance_running()
        .instance_ids(instance_id)
        .wait(std::time::Duration::from_secs(300));

    match waiter.await {
        Ok(_) => {
            println!("✅ Instance is now running!");
            // Get and display the public IP
            let status = get_instance_info(client, instance_id).await?;
            if let Some(ip) = status.public_ip {
                println!("🌐 Public IP: {}", ip);
                println!("🔗 SSH: ssh -i dev-key.pem ubuntu@{}", ip);
            }
        }
        Err(e) => {
            println!("⚠️  Wait timeout or error: {}", e);
            println!("   Instance may still be starting. Check status with 'status' command.");
        }
    }

    Ok(())
}

async fn stop_instance(client: &Client, instance_id: &str) -> Result<()> {
    println!("🛑 Stopping instance: {}", instance_id);

    client
        .stop_instances()
        .instance_ids(instance_id)
        .send()
        .await
        .context("Failed to stop instance")?;

    println!("✅ Stop command sent successfully");
    println!("💰 Instance will stop billing for compute (storage still charged)");

    println!("⏳ Waiting for instance to stop...");
    let waiter = client
        .wait_until_instance_stopped()
        .instance_ids(instance_id)
        .wait(std::time::Duration::from_secs(300));

    match waiter.await {
        Ok(_) => println!("✅ Instance is now stopped."),
        Err(e) => {
            println!("⚠️  Wait timeout or error: {}", e);
            println!("   Instance may still be stopping. Check status with 'status' command.");
        }
    }

    Ok(())
}

async fn check_status(client: &Client, instance_id: &str) -> Result<()> {
    let info = get_instance_info(client, instance_id).await?;

    println!("📊 Instance Status:");
    println!("   ID: {}", instance_id);
    println!("   State: {}", format_state(&info.state));
    
    if let Some(ip) = info.public_ip {
        println!("   Public IP: {}", ip);
        if info.state == "running" {
            println!("   SSH: ssh -i dev-key.pem ubuntu@{}", ip);
        }
    }
    
    if let Some(instance_type) = info.instance_type {
        println!("   Type: {}", instance_type);
    }

    // Show billing status
    match info.state.as_str() {
        "running" => println!("   💸 Currently billing for compute + storage"),
        "stopped" => println!("   💰 Only billing for storage (much cheaper)"),
        _ => println!("   ⏳ Transitioning state"),
    }

    Ok(())
}

async fn get_instance_info(client: &Client, instance_id: &str) -> Result<InstanceInfo> {
    let resp = client
        .describe_instances()
        .instance_ids(instance_id)
        .send()
        .await
        .context("Failed to describe instance")?;

    let instance = resp
        .reservations()
        .first()
        .and_then(|r| r.instances().first())
        .context("Instance not found")?;

    let state = instance
        .state()
        .and_then(|s| s.name())
        .map(|s| format!("{:?}", s))
        .unwrap_or_else(|| "unknown".to_string())
        .to_lowercase();

    let public_ip = instance.public_ip_address().map(|s| s.to_string());
    let instance_type = instance.instance_type().map(|t| format!("{:?}", t));

    Ok(InstanceInfo {
        state,
        public_ip,
        instance_type,
    })
}

fn format_state(state: &str) -> String {
    match state.as_ref() {
        "running" => "🟢 running".to_string(),
        "stopped" => "🔴 stopped".to_string(),
        "stopping" => "🟡 stopping".to_string(),
        "pending" => "🟡 pending".to_string(),
        _ => format!("⚪ {}", state),
    }
}

struct InstanceInfo {
    state: String,
    public_ip: Option<String>,
    instance_type: Option<String>,
}
