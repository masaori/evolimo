# GPU開発環境 on AWS

simulatorをEC2 GPUインスタンスで実行し、visualizerをローカルで実行するための開発環境です。

## 構成

- **Simulator**: EC2 g4dn.xlarge (GPU) インスタンス上で実行
- **Visualizer**: ローカルマシンで実行
- **データ同期**: rsyncでローカルとクラウド間で同期
- **コスト最適化**: 未使用時にはインスタンスを停止（ストレージのみ課金）

## 前提条件

- [Terraform](https://www.terraform.io/downloads) がインストール済み
- AWS CLIが設定済み（`aws configure`で認証情報を設定）
- Rustツールチェーンがインストール済み

## セットアップ手順

### 1. インフラ構築

```bash
cd infrastructure/dev-cloud
### (初回のみ) バックエンドS3バケットを作成
cd bootstrap
terraform init
terraform apply
BUCKET=$(terraform output -raw bucket_name)
cd ..

terraform init -backend-config="bucket=$BUCKET"
terraform apply
```

出力される情報をメモしてください：
- `instance_id`: インスタンスの起動/停止に使用
- `public_ip`: 参考情報 (SSM接続では不要)

初回は最新AMIで構築されます。再現性のために固定したい場合は、`terraform output resolved_ami_id` で得たIDを次回以降 `-var "ami_id=ami-xxxxxxxx"` に指定してください（毎回指定する必要はありません）。

### 2. SSM Session Manager で接続

```bash
aws ssm start-session --target <instance_id>
```

SSH互換で使いたい場合（ポートフォワード）:

```bash
aws ssm start-session --target <instance_id> \
    --document-name AWS-StartPortForwardingSession \
    --parameters 'portNumber=["22"],localPortNumber=["2222"]'

ssh -p 2222 ubuntu@localhost
```

### 3. 制御コマンドのビルド

```bash
cd infrastructure/dev-cloud
cargo build --release
```

バイナリは `target/release/cloud-control` に生成されます。

## 使用方法

### インスタンス制御

#### インスタンスのステータス確認
```bash
./target/release/cloud-control status --instance-id <instance_id>
```

#### インスタンスの起動
```bash
./target/release/cloud-control start --instance-id <instance_id>
```

起動完了後、Public IPが表示されます。

#### インスタンスの停止（コスト削減）
```bash
./target/release/cloud-control stop --instance-id <instance_id>
```

**重要**: 使用しない時は必ず停止してください！

### 開発ワークフロー

#### 1. インスタンスを起動

```bash
cd infrastructure/dev-cloud
./target/release/cloud-control start --instance-id <instance_id>
```

#### 2. SSMでログイン

```bash
aws ssm start-session --target <instance_id>
```

#### 3. クラウド上で開発

リモートサーバー上で:

```bash
# リポジトリをクローン
git clone https://github.com/masaori/evolimo.git
cd evolimo

# Simulatorをビルド & 実行
cd simulator
cargo build --release
cargo run --release -- --def universal_gravitation --max-sim-frames 600
```

#### 4. ローカルで可視化

ローカルマシンで新しいターミナルを開き:

```bash
# 出力ファイルをrsyncでダウンロード
rsync -avz aws-gpu:~/evolimo/simulator/output/ ./simulator/output/

# Visualizerを実行
cd visualizer
cargo run --release -- ../simulator/output/universal_gravitation.evo
```

#### 5. 開発完了後にインスタンスを停止

```bash
cd infrastructure/dev-cloud
./target/release/cloud-control stop --instance-id <instance_id>
```

### 継続的な同期（オプション）

ローカルで変更を監視して自動同期する場合:

```bash
# ローカル → クラウド (開発中)
watch -n 5 rsync -avz --exclude target --exclude node_modules ./simulator/ aws-gpu:~/evolimo/simulator/

# クラウド → ローカル (出力ファイル)
watch -n 10 rsync -avz aws-gpu:~/evolimo/simulator/output/ ./simulator/output/
```

## コスト管理

### 課金体系

| 状態 | 課金内容 | 月額概算 (参考) |
|------|---------|----------------|
| 実行中 | コンピュート + ストレージ | $0.71/時間 × 使用時間 |
| 停止中 | ストレージ + Elastic IP | ~$5-10/月 |
| 削除後 | なし | $0 |

### ベストプラクティス

1. **毎日の作業後は停止**: 夜間や週末は必ず停止
2. **長期間使わない場合**: `terraform destroy` で完全削除
3. **ステータス確認の習慣化**: 起動したままにしていないか定期確認

## トラブルシューティング

### セッションを開始できない

```bash
# インスタンスが起動しているか確認
./target/release/cloud-control status --instance-id <instance_id>

# SSMエージェントが有効か確認 (インスタンス内)
sudo systemctl status snap.amazon-ssm-agent.amazon-ssm-agent.service || sudo systemctl status amazon-ssm-agent

# IAMロールに AmazonSSMManagedInstanceCore が付与されているか確認
```

### ストレージが足りない

インスタンス作成後にEBSボリュームを拡張:

```bash
# AWSコンソールまたはCLIでボリュームサイズを増やす
# その後、インスタンス内で:
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1
```

## クリーンアップ

プロジェクト終了時、すべてのリソースを削除:

```bash
cd infrastructure/dev-cloud
terraform destroy
```

⚠️ これによりすべてのデータが削除されます。必要なファイルは事前にバックアップしてください。

## 参考情報

- [AWS EC2 料金](https://aws.amazon.com/ec2/pricing/on-demand/)
- [g4dn インスタンス仕様](https://aws.amazon.com/ec2/instance-types/g4/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
