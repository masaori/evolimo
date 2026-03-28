#!/bin/bash
# Quick helper script to get instance ID from Terraform output

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "terraform.tfstate" ]; then
    echo "Error: terraform.tfstate not found. Run 'terraform apply' first."
    exit 1
fi

INSTANCE_ID=$(terraform output -raw instance_id 2>/dev/null)

if [ -z "$INSTANCE_ID" ]; then
    echo "Error: Could not get instance_id from Terraform output."
    exit 1
fi

echo "Instance ID: $INSTANCE_ID"
echo ""
echo "Quick commands:"
echo "  Status: ./target/release/cloud-control status --instance-id $INSTANCE_ID"
echo "  Start:  ./target/release/cloud-control start --instance-id $INSTANCE_ID"
echo "  Stop:   ./target/release/cloud-control stop --instance-id $INSTANCE_ID"
