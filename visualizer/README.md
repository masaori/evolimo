# Visualizer設計提案

本ドキュメントは、`simulator` が出力する `.evo` ファイルを Rust で読み込み、再生・可視化するための設計案です。実装は含みません。

## 1. 対応対象とスコープ
- 入力: `simulator` の `EvoRecorder` が生成する `.evo` バイナリ
- 出力: デスクトップ用のインタラクティブ再生 UI（将来的に動画・画像エクスポートを追加可能）
- 非目標: Web移植、リアルタイム大規模分散描画（別途検討）

### 前提: evolimo が扱うもの
- 物理シミュレーションで進化するエージェント群を扱い、状態は少なくとも `pos_x`, `vel_x`, `energy` を含む（`recorder.rs` 時点）。
- Phenotype パラメータは属性/物理グループへ分岐し、状態更新に影響する。
- `.evo` にはヘッダー（メタ情報）とフレーム列（全エージェント×state_dimsの `f32`）が記録される。

### 必須ビュー（最小セット）
1. **Overview**: メタ情報（timestamp, dt, save_interval, total_frames, state_labels）と再生コントロール（再生/停止/シーク/FPS）。
2. **Scatter/Map**: `pos_x` vs 任意軸（例: `energy`）を散布図表示。2軸は state_labels から選択式。
3. **Line (Time-series)**: 指定エージェントの `energy` などを時系列で表示（シーク位置に同期）。
4. **Histogram**: 現在フレームにおける単一 state の分布（例: energy 分布）。
5. **Table (optional)**: 現在フレームの統計サマリ（mean/max/min/percentile）を軽量に表示。

### 用語
- **フレームスライス**: ボディに連続配置された1フレーム分（全エージェント×全state_dims）のバイト列を `&[f32]` として解釈したもの。例: `n_agents=3, state_dims=2` → `[a0_d0, a0_d1, a1_d0, a1_d1, a2_d0, a2_d1]`。

## 2. `.evo` ファイルフォーマット（現状仕様の整理）
`recorder.rs` より:
- 先頭4バイト: マジック `b"EVO1"`
- 次の4バイト: ヘッダー長 (u32, Little Endian)
- ヘッダー: JSON (`EvoHeader`)  
  - `version: u32`, `timestamp: RFC3339`
  - `config: { n_agents, state_dims, state_labels[], dt }`
  - `playback: { total_frames, save_interval }`
- ボディ: フレーム列。各フレームは `n_agents * state_dims` 個の `f32` を行優先で格納。
- 1フレームの経過時間 = `dt * save_interval`

## 3. アーキテクチャ案（Rustクレート）
```
visualizer/
├── Cargo.toml          # binクレート `evolimo-visualizer`
└── src/
    ├── io.rs           # ファイルパーサ & メモリマップ読み出し
    ├── playback.rs     # フレームインデクス管理、シーク/ループ
    ├── render/
    │   ├── mod.rs      # `egui` ベースのUI
    │   └── plots.rs    # 1D/2Dプロット、ヒートマップ等
    ├── app.rs          # イベントループ統合 (`eframe`)
    └── cli.rs          # `--file`, `--headless` オプション
```
- `io.rs`: ヘッダー検証（マジック・サイズ上限・version）、`memmap2` でボディをゼロコピー読み込み、`bytemuck::cast_slice` で `&[f32]` 変換。フレームサイズと境界を事前計算。
- `playback.rs`: `PlaybackState { current_frame, fps, looping }` とタイムステップ管理。  
  基本は単一スレッド/同期I/Oで進め、ファイルサイズが1GB超で高速シーク（例: 60fpsスクラブ）を求める場合のみ、非同期プリフェッチ＋`parking_lot::RwLock` 共有を有効化（閾値は設定可能にする）。
- `render/`: `egui` (`eframe`/`wgpu` バックエンド) を利用。タブ例:  
  - **Overview**: 時刻・フレーム情報、ヘッダーメタ表示  
  - **Scatter**: `state_labels` を軸に任意2D散布図 (`pos_x` vs `energy` など)  
  - **Line**: 任意エージェントの時系列  
  - **Histogram**: 分布確認
- `cli.rs`: `--file <path>` 必須。`--headless --out <png|mp4>` は将来拡張でプレースホルダ実装。

## 4. 使用ライブラリ候補
- パーサ: `serde`, `serde_json`, `memmap2`, `bytemuck`
- UI/描画: `egui` + `eframe` (同梱 `wgpu`)、軽量でセットアップ容易
- プロット: 標準は `egui_plot`（`egui` addon, 依存追加最小）。高解像度バッチ出力が必要になった場合のみ `plotters` を追加検討。
- 同期: `parking_lot`（軽量な `RwLock` 用途）
- 非同期: 必要なら `tokio` をオプション化（標準は同期で十分）

## 5. 処理フロー
1. CLIで `.evo` パス受け取り → `io::load_evo(path)`
2. ヘッダー検証・読込 → `EvoMeta`
3. `Playback` が `frame_stride = n_agents * state_dims` から任意フレームの `&[f32]` スライスを返却
4. UIスレッド: `egui` で入力処理（再生/停止/シーク/ループ/FPS変更）
5. レンダリング: 要求された可視化に応じてフレームスライス（1フレーム分の `&[f32]`）を  
   CPU 側で `Vec<(x,y,...)>` へ変換し GPU にアップロード

## 6. テスト方針
- `io` 周りは `.evo` のサンプルを `simulator` テストから再利用し、ヘッダー整合性・フレーム境界・バイトオーダーを検証。
- `playback` は境界シーク・ループ時のインデックス計算をユニットテスト。
- UIはスナップショット/ゴールデン画像は行わず、ヘッドレス実行でクラッシュしないことを確認する軽量テストのみ。

## 7. 段階的実装ロードマップ
1. `io` & `playback` の最小読み出し/シークを実装、CLIでダンプ確認
2. `egui` の土台 + Overviewタブ
3. 散布図・ラインプロットなど基本可視化
4. エクスポート機能（PNG/MP4）とスクリプト自動化

以上の方針で、`simulator` で生成される `.evo` をシンプルに読み取り、段階的に可視化を拡張できる構成を提案します。
