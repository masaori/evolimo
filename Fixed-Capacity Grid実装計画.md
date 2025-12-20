## 現状の実装調査結果と実装方針

### 1. 現状の実装分析

#### 計算アルゴリズム
現在は **O(N²)の全ペア計算** が実装されています：

```rust
// dynamics.rsの重力計算部分（自動生成コード）
let temp_9 = s_pos_x.transpose(0, 1)?;          // [N,1] -> [1,N]
let temp_10 = temp_9.broadcast_sub(&s_pos_x)?; // [1,N] - [N,1] -> [N,N]
// ↑全エージェント間の距離行列を作成
```

TypeScript定義では：
```typescript
const xT = ops.transpose(x, 0, 1);
const dx = ops.sub(xT, x);  // N×Nの距離行列
const ax_grav = ops.sum(ops.mul(ops.mul(mT, dx), inv_r2), 1, true);
```

**問題点：**
- 1000エージェントで100万回の距離計算
- メモリ使用量：N×Nの行列が複数（dx, dy, d2など）
- 計算量：O(N²)、エージェント数が増えると急激に悪化

#### データ構造
- State: `[N_AGENTS, STATE_DIMS]` テンソル
- 位置: `pos_x`, `pos_y` を個別のカラムとして管理
- Torus境界条件対応済み（10240×8000の空間）

#### 使用フレームワーク
- **candle-core 0.9.1**: Rustテンソルライブラリ
- Metal/CUDA対応（GPU並列化）

---

### 2. グリッドベース近傍計算の実装方針

#### 設計方針

**A. アーキテクチャ分離**
1. **Domain Model層** (TypeScript)
   - グリッド設定パラメータを追加
   - 新しいoperator（グリッド化、近傍計算）を定義
   
2. **Compiler層**
   - グリッド操作のIR拡張
   
3. **Simulator層** (Rust)
   - グリッドテンソル操作の実装
   - カスタムカーネルの可能性

#### B. 具体的な実装ステップ

**Phase 1: データ構造設計**

```rust
// 新しいグリッド構造体
pub struct SpatialGrid {
    grid_h: usize,         // グリッド高さ
    grid_w: usize,         // グリッド幅
    cell_capacity: usize,  // セルあたり最大粒子数
    cell_size: (f32, f32), // セルのサイズ
}

// State表現の拡張
// [N, STATE_DIMS] から [Grid_H, Grid_W, Capacity, STATE_DIMS] へ
```

**グリッドパラメータの推定：**
- 空間: 10240×8000
- エージェント: 1000
- セルサイズ候補: 128×128 → 80×63グリッド ≈ 5040セル
- 平均密度: 1000/5040 ≈ 0.2個/セル
- 容量: 4~8個/セル（疎な分布を想定）

**Phase 2: グリッド化操作**

```rust
// 疑似コード
fn particles_to_grid(
    positions: &Tensor,  // [N, 2]
    state: &Tensor,      // [N, STATE_DIMS]
    grid_config: &SpatialGrid
) -> Result<Tensor> {
    // [Grid_H, Grid_W, Capacity, STATE_DIMS+1]
    // +1はvalid flagまたはmask用
    
    // 1. グリッドインデックス計算
    let grid_indices = positions / cell_size;
    let grid_x = grid_indices.narrow(1, 0, 1).floor().to_dtype(i64);
    let grid_y = grid_indices.narrow(1, 1, 1).floor().to_dtype(i64);
    
    // 2. セル内カウンタを管理しながらscatter
    // candleのindex_add/scatter系を使用
    
    // 3. 空きスロットをマスク値で埋める
}
```

**Phase 3: 近傍計算（ステンシル計算）**

```rust
fn compute_neighbor_forces(
    grid: &Tensor,  // [H, W, Cap, STATE_DIMS]
    neighbor_range: usize, // 1 = 3×3近傍, 2 = 5×5近傍
) -> Result<Tensor> {
    // 中心セルと8近傍（または24近傍）との相互作用
    
    // Approach 1: パディング+シフト
    let padded = grid.pad(...)?;
    let mut forces = Tensor::zeros_like(grid)?;
    
    for dy in -neighbor_range..=neighbor_range {
        for dx in -neighbor_range..=neighbor_range {
            if dx == 0 && dy == 0 { continue; }
            
            // シフトしたグリッド
            let shifted = shift_grid(&padded, dx, dy)?;
            
            // ブロードキャストで [H,W,Cap,Cap] の相互作用
            let pairwise_force = compute_pairwise(
                &grid, &shifted
            )?;
            forces = forces.add(&pairwise_force)?;
        }
    }
    
    forces
}
```

**Phase 4: グリッド→パーティクル変換**

```rust
fn grid_to_particles(
    grid: &Tensor,
    original_indices: &Tensor,
) -> Result<Tensor> {
    // グリッドから元のN個のエージェントに戻す
    // Gather操作
}
```

---

### 3. 実装上の課題と解決策

| 課題 | 解決策 |
|------|--------|
| **candleのscatter/gather制約** | カスタムカーネル（cuRAND的）を実装するか、argsort+gatherで代替 |
| **固定容量の無駄** | 動的容量は難しいため、統計的に適切な容量（平均+3σ）を設定 |
| **Torus境界の近傍** | パディング時に反対側をラップする処理を追加 |
| **TypeScript IR拡張** | 新しいopとして`grid_scatter`, `grid_gather`, `stencil`を追加 |

---

### 4. パフォーマンス見積もり

**現状（全ペア）:**
- 計算量: O(N²) = O(1,000,000)
- メモリ: N×N×複数の行列

**グリッド方式（3×3近傍）:**
- 計算量: O(N × 9 × Capacity) ≈ O(1000 × 9 × 4) = O(36,000)
- **約28倍の高速化**
- メモリ: Grid_H × Grid_W × Capacity ≈ 5000 × 4 = 20,000要素（固定）

---

### 5. 推奨実装順序

2. **Phase 1: TypeScript DSL拡張** 
   - グリッド設定の定義
   - 新しいoperatorの追加
   - IR出力の拡張

3. **Phase 2: Compilerとcode generator更新** 
   - IR→Rustコード生成ロジック
   - グリッド操作の生成

4. **Phase 3: 最適化** 
   - カスタムカーネル
   - メモリレイアウト最適化

### 進捗状況

Phase 1: done
以下の変更を行いました：

types.ts:

GridConfig インターフェースを追加しました。
Expression 型に grid_scatter, stencil, grid_gather を追加しました。
OutputIR に grid_config フィールドを追加しました。
Operation 型に新しいオペレーションと必要なフィールド (dim, keepdim, stencil_range 等) を追加しました。
builder.ts:

ops オブジェクトに grid_scatter, stencil, grid_gather 関数を追加しました。
compiler.ts:

compileExpression 関数を更新し、新しいオペレーションのコンパイルロジックを追加しました。
collectStates, collectParams 関数を更新し、新しいオペレーションの引数 (x, y) を探索するようにしました。
compileRules 関数を更新し、gridConfig を受け取り OutputIR に含めるようにしました。
main 関数を更新し、定義ファイルから GRID_CONFIG を読み込むようにしました。
これにより、TypeScript DSLでグリッドベースの計算を定義し、JSON IRとして出力する準備が整いました。既存の定義ファイルは GRID_CONFIG がないため、影響を受けずに動作します。

Phase 2: done
以下の変更を行いました：

simulator/src/grid.rs:
`SpatialGrid` 構造体と、グリッド操作関数 (`particles_to_grid`, `grid_to_particles`, `shift_grid`, `solve_gravity_stencil`) を実装しました。
`particles_to_grid` は CPU 上でスロット割り当てを行い、`candle` のテンソル操作でグリッドを構築します。
`solve_gravity_stencil` はグリッド上での重力相互作用（近傍計算）を実装しました。

simulator/scripts/generators/generate-phenotype-physics.rs:
`ConfigIR` に `grid_config` を追加し、`Operation` に `stencil_range` を追加しました。
`generate_dynamics` 関数を更新し、`grid_scatter`, `grid_gather`, `stencil` オペレーションのコード生成ロジックを追加しました。
`stencil` オペレーションは `crate::grid::solve_gravity_stencil` を呼び出すように生成されます。

simulator/src/lib.rs:
`grid` モジュールを公開しました。

Phase 3: 未着手
