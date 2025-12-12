# Simulator TODO

このファイルは、`domain-model`で宣言した相互作用（近傍粒子同士の相互作用）を、`simulator`でどのように実行するかの実装メモです。

## 現状（段階A）の意図と実装概要

### 目的
- 「衝突判定」ではなく「近傍相互作用」をシミュレートしたい。
- すべてを宣言的/設定的に“計算グラフ”として表現したい。
- `size`は「これ以上近づけない」距離（半径）として、互いに反発する制約を与えたい。

### 設計方針（段階A）
- 計算グラフの中に、近傍相互作用を表す **新しいノード** を導入する。
  - ただし近傍探索やペア列挙は、既存の `Expression` 木だけでは表現しにくいので、IRに `interactions` を追加して表現する。
- 生成されたRustコードは、
  1) `interactions`を評価して（例: 反発力 `f_excl_x/y` を作る）
  2) その出力を通常の `operations` の計算グラフに合流させる
  という順序で実行する。

### IR / DSLの拡張ポイント
- `domain-model/src/types.ts`
  - `OutputIR.interactions?: InteractionIR[]` を追加
  - `InteractionIR`として `all_pairs_exclusion_2d`（段階A用）を追加
  - `Expression`に `ref_aux` を追加（相互作用出力を式から参照するため）
- `domain-model/src/builder.ts`
  - `ops.aux(id)` を追加（`ref_aux`を生成）
- `domain-model/src/definition.ts`
  - `INTERACTIONS` を追加（例: `all_pairs_exclusion_2d`で `size`半径の反発力を定義）
  - 相互作用の出力（例: `f_excl_x/y`）を `vel_x/vel_y` の更新式に組み込む
  - `STATE_VAR_ORDER` を導入して state tensorの順序を安定化
- `domain-model/src/compiler.ts`
  - `interactions`をJSONに出力
  - `ref_aux`をコンパイル可能に
  - state_vars抽出を「targetだけ」から「参照されるstateも含める」へ修正
  - ルールで更新されないstate（例: `size`）はパススルー代入を自動追加

### simulator側の生成と実行（段階A）
- `simulator/scripts/generators/generate-phenotype-physics.rs`
  - `interactions`をDeserializeして、`update_physics`冒頭で評価
  - 段階Aは **全ペア（O(N^2)）** をCPUで列挙して反発力を計算
    - `state.to_vec2()`でホスト側`Vec<Vec<f32>>`へ取り出して計算
    - 出力は `(n_agents, 1)` の `Tensor` として `f_excl_x/y` を生成
  - その後、既存の `operations` 展開が `f_excl_x/y` を普通の変数として参照できる
  - `STATE_DIMS`/`STATE_VARS` を生成ファイルからexport
  - 生成器のパスは `CARGO_MANIFEST_DIR` からrepo rootを辿るようにし、CWD依存を排除
- `simulator/src/main.rs`
  - `STATE_DIMS/state_labels` を生成側（`_gen::physics::{STATE_DIMS, STATE_VARS}`）に追従

### all_pairs_exclusion_2d の仕様（段階A）
- 入力: `pos_x/pos_y`（位置）, `size`（半径）
- 近づけない条件: 2粒子の距離が `(ri + rj)` 未満になると反発（判定というよりバリア/反発）
- 実装（現状）
  - `d2 = dx^2 + dy^2 + eps`
  - `delta = (ri+rj)^2 - d2`
  - `delta > 0` のとき反発
  - 係数: `m = strength * delta / d2`
  - 力: `(fx,fy) += (m*dx, m*dy)`（iへ加算、jへ反対符号で加算）
  - `cutoff` があれば `d2 > cutoff^2` は無視

### 段階Aの限界
- `state.to_vec2()` を使うため、
  - GPU/Metal利用時にホスト転送が発生しやすい
  - 大規模Nでは性能が伸びない
- 全ペアでO(N^2)

---

## 段階B（近傍探索でスケールさせる） TODO

段階Bのゴールは「**IR/DSLは変えず**、`all_pairs_exclusion_2d` の実装を **近傍のみ列挙** する形に置き換える」ことです。

### 1. 近傍データ構造（セルリスト/Uniform Grid）
- [ ] ワールドをセルに分割（セルサイズは `cutoff` を基準に）
  - 推奨: `cell_size = cutoff`（または少し大きめ）
- [ ] 各粒子のセルIDを計算し、`cell -> particle indices` のリストを構築
- [ ] 各粒子iについて、
  - 同一セル + 周囲8セル（2D）に入っている粒子jだけを候補にする
  - `i<j` のみ計算して、力を対称に加算

### 2. 実装の置き場所
- [ ] 自動生成コードに直接巨大ロジックを出すのではなく、
  - `simulator/src/interaction/all_pairs_exclusion_2d.rs` のような手書き実装へ逃がし
  - 生成コードはその関数を呼ぶだけにする（生成差分を小さくする）

### 3. デバイス/テンソル境界の扱い
- [ ] 段階Bでも一旦CPU実装でOK（まず正しく動かす）
- [ ] ただし `state` がGPUに載る場合の方針を決める
  - 方針A: 相互作用はCPU固定（毎ステップホスト転送）
  - 方針B: 相互作用もGPU/Metalで実行（Candleの演算だけで済ませる or カスタムカーネル）
- [ ] 当面の現実案: CPU固定 + Nが増えるときは段階Bで軽量化

### 4. 正しさ（段階Aとの一致テスト）
- [ ] 同一初期stateで、段階A（全ペア）と段階B（近傍）を比較
  - `cutoff` がある場合は一致すべき（候補列挙が完全なら）
- [ ] 小N（例: 32, 64）で`fx/fy`の最大誤差をチェックするテストを追加

### 5. パフォーマンス計測
- [ ] N=1k, 10k程度でstep/sを測る
- [ ] `cutoff` と密度（分布）でのスケールを確認
- [ ] 主要ボトルネック（セル構築/近傍走査/テンソル変換）をログ出し

### 6. IRの拡張余地（必要になったら）
- [ ] `kernel`（softplus/relu等）や、`radius`の結合（ri+rj以外）をIRで表現
- [ ] 近傍集約（密度、平均速度など）の `neighbor_reduce` ノードを追加
- [ ] 3D対応（セル近傍26セル）
