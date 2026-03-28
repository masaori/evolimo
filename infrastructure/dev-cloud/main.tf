terraform {
  backend "s3" {
    key    = "dev-cloud/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    aws   = { source = "hashicorp/aws", version = "~> 5.0" }
    local = { source = "hashicorp/local", version = "~> 2.0" }
    tls   = { source = "hashicorp/tls", version = "~> 4.0" }
  }
}

provider "aws" {
  region = "ap-northeast-1" # 東京リージョン
}

variable "ami_id" {
  type        = string
  description = "(optional) Known-good DLAMI AMI ID to pin. Leave empty to use the latest filtered AMI."
  default     = ""
}

# --- 1. NVIDIAドライバ入りAMI (Ubuntu 22.04) ---
# 明示的にAMIを指定したい場合は var.ami_id に設定する
data "aws_ami" "dlami_ubuntu" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["Deep Learning AMI GPU PyTorch 2.* (Ubuntu 22.04)*"]
  }
}

# --- 3. SSHキーペア生成 ---
resource "tls_private_key" "dev_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "generated_key" {
  key_name   = "gpu-dev-key-ondemand"
  public_key = tls_private_key.dev_key.public_key_openssh
}

resource "local_file" "private_key_pem" {
  content         = tls_private_key.dev_key.private_key_pem
  filename        = "${path.module}/dev-key.pem"
  file_permission = "0400"
}

# --- 4. セキュリティグループ ---
resource "aws_security_group" "dev_sg" {
  name        = "gpu-dev-sg"
  description = "Session Manager only (no inbound SSH)"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- 4. SSM用のIAMロール ---
data "aws_iam_policy_document" "ssm_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ssm_role" {
  name               = "gpu-dev-ssm-role"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm_instance_profile" {
  name = "gpu-dev-ssm-instance-profile"
  role = aws_iam_role.ssm_role.name
}

# --- 5. インスタンス本体 (On-Demand) ---
resource "aws_instance" "gpu_server" {
  ami                  = var.ami_id != "" ? var.ami_id : data.aws_ami.dlami_ubuntu.id
  instance_type        = "g4dn.xlarge" # 約 $0.71/h (停止可能)
  iam_instance_profile = aws_iam_instance_profile.ssm_instance_profile.name
  
  key_name               = aws_key_pair.generated_key.key_name
  vpc_security_group_ids = [aws_security_group.dev_sg.id]

  # 100GBのストレージ (停止中もデータ保持)
  root_block_device {
    volume_size = 100
    volume_type = "gp3"
  }

  # Dev Container用にDockerとNVIDIA Container Toolkitをセットアップ
  # さらにホストでの開発用にNode.jsとRustもインストールします
  user_data = <<-EOF
    #!/bin/bash
    set -euxo pipefail

    # パッケージ更新と必須ツール
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release software-properties-common

    # Docker (公式リポジトリではなく標準の docker.io で十分)
    apt-get install -y docker.io
    systemctl enable --now docker
    usermod -aG docker ubuntu

    # NVIDIA Container Toolkit (keyring方式)
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' \
      | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update
    apt-get install -y nvidia-container-toolkit
    systemctl restart docker

    # Node.js (v24)
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs build-essential

    # Rust (ubuntuユーザー向け)
    su - ubuntu -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'

    # SSM Agent (DLAMIは通常導入済みだが念のため起動)
    systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service || true
    systemctl enable --now amazon-ssm-agent || true
  EOF

  tags = {
    Name = "gpu-dev-box"
  }
}

# --- 6. 固定IP (Elastic IP) ---
# 停止・再開してもIPが変わらないようにします
resource "aws_eip" "gpu_ip" {
  instance = aws_instance.gpu_server.id
  domain   = "vpc"
}

# --- 7. 出力情報 ---
output "instance_id" {
  value = aws_instance.gpu_server.id
}

output "public_ip" {
  value = aws_eip.gpu_ip.public_ip
}

output "ssm_start_command" {
  value = "aws ssm start-session --target ${aws_instance.gpu_server.id}"
}

output "resolved_ami_id" {
  value = aws_instance.gpu_server.ami
}
