このプロジェクトは **「TypeScriptによる定義(Configuration as Code)」** から **「Rustの高性能テンソル計算コード」** を自動生成する、Monorepo構成の生物進化シミュレーターです。

-----

# プロジェクト構成と実装詳細

## ディレクトリ構造 (Monorepo)

```text
root/
├── domain-model/              # 定義・設定領域
│   ├── src/
│   │   ├── builder.ts         # DSLの定義 (ライブラリ)
│   │   ├── definition.ts      # ユーザーが記述する物理法則と遺伝子定義
│   │   └── compiler.ts        # TS -> JSON の変換スクリプト
│   ├── _gen/                  # 生成物格納用
│   │   └── physics_ir.json    # Rustが読み込む中間定義ファイル
│   └── package.json
│
├── simulator/                 # Rustシミュレーション領域
│   ├── Cargo.toml             # candle-core, candle-nn, serde, serde_json
│   ├── build.rs               # JSONからRustコードを生成するビルドスクリプト
│   ├── src/
│   │   ├── main.rs            # エントリーポイント
│   │   ├── lib.rs
│   │   ├── lifecycle.rs       # 世代交代・ライフサイクル管理
│   │   ├── _gen_phenotype.rs  # [自動生成] 遺伝子発現ネットワーク定義
│   │   └── _gen_physics.rs    # [自動生成] 物理演算カーネル関数
│   └── scripts/               # 補助スクリプト等
│
└── visualizer/                # (Future work)
    └── .gitkeep
```

-----

## 1\. Domain Model Layer (`domain-model/`)

TypeScriptを用いて物理法則とパラメータ構造を定義し、Rustが解釈可能なJSONを出力します。

### `src/builder.ts` (DSL Core)

変数の型安全性と演算の構築ロジックを提供します。

```typescript
// パラメータグループの定義（アクティベーションの種類を持つ）
export type ActivationType = 'softmax' | 'tanh' | 'sigmoid' | 'none';

export interface GroupConfig {
  name: string;
  activation: ActivationType;
}

// 演算ノードの型定義
export type Expression = 
  | { op: 'ref_state', id: string }
  | { op: 'ref_param', id: string, group: string }
  | { op: 'const', value: number }
  | { op: 'add', left: Expression, right: Expression }
  | { op: 'sub', left: Expression, right: Expression }
  | { op: 'mul', left: Expression, right: Expression }
  | { op: 'div', left: Expression, right: Expression }
  | { op: 'relu', value: Expression };

// DSLヘルパー
export const ops = {
  state: (id: string) => ({ op: 'ref_state', id } as const),
  // パラメータは必ずグループに所属する
  param: (id: string, group: string) => ({ op: 'ref_param', id, group } as const),
  const: (val: number) => ({ op: 'const', value: val } as const),
  
  add: (a: Expression, b: Expression) => ({ op: 'add', left: a, right: b } as const),
  sub: (a: Expression, b: Expression) => ({ op: 'sub', left: a, right: b } as const),
  mul: (a: Expression, b: Expression) => ({ op: 'mul', left: a, right: b } as const),
};

export interface PhysicsRule {
  target_state: string;
  expr: Expression;
}
```

### `src/definition.ts` (User Configuration)

実際の物理法則と遺伝子パラメータの定義です。

```typescript
import { ops, GroupConfig, PhysicsRule } from './builder';

// 1. グループ定義 (Phenotype Engineの出力構造)
export const GROUPS = {
  ATTR: { name: 'attributes', activation: 'softmax' } as GroupConfig, // 合計1.0 (配分)
  PHYS: { name: 'physics',    activation: 'tanh' }    as GroupConfig, // -1.0~1.0 (物理係数)
};

// 2. 変数・パラメータ定義
const S = {
  x: ops.state('pos_x'),
  v: ops.state('vel_x'),
  energy: ops.state('energy'),
};

const P = {
  // ATTRグループ: 基礎代謝、移動効率（トレードオフ関係）
  metabolism: ops.param('metabolism', GROUPS.ATTR.name),
  move_cost:  ops.param('move_cost',  GROUPS.ATTR.name),
  
  // PHYSグループ: 物理特性
  drag: ops.param('drag_coeff', GROUPS.PHYS.name),
};

const C = {
  dt: ops.const(0.1),
};

// 3. 物理更新ルール
export const rules: PhysicsRule[] = [
  // 速度更新: v = v - (v * drag * dt)
  {
    target_state: 'vel_x',
    expr: ops.sub(S.v, ops.mul(ops.mul(S.v, P.drag), C.dt))
  },
  // 位置更新: x = x + v * dt
  {
    target_state: 'pos_x',
    expr: ops.add(S.x, ops.mul(S.v, C.dt))
  },
  // エネルギー消費
  {
    target_state: 'energy',
    expr: ops.sub(S.energy, ops.mul(P.metabolism, C.dt))
  }
];
```

### `src/compiler.ts` (Generator)

定義を解析し、JSONを出力します。ここでパラメータの順序（Index）を確定させます。

```typescript
// 出力JSONのインターフェース
interface OutputIR {
  state_vars: string[]; // ['pos_x', 'vel_x', 'energy']
  groups: {
    [groupName: string]: {
      activation: string;
      params: string[]; // ['metabolism', 'move_cost'] -> 順序が重要
    }
  };
  operations: Array<{
    target: string;
    op: string;
    args: string[]; // 中間変数IDやパラメータ参照ID
  }>;
}

// ... トポロジカルソートとFlatteningの実装 ...
// コンパイル結果を ../_gen/physics_ir.json に書き出す
```

-----

## 2\. Simulator Layer (`simulator/`)

### `build.rs` (Code Generator)

中間JSON (`physics_ir.json`) を読み込み、Rustコードを `OUT_DIR` に生成します。

```rust
use std::env;
use std::fs;
use std::path::Path;
use std::collections::HashMap;
use serde::Deserialize;

// JSON読み込み用Struct (手書き定義)
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
    target: String, // 最終的な更新対象または中間変数名
    op: String,
    args: Vec<String>,
}

fn main() {
    // 変更検知設定
    println!("cargo:rerun-if-changed=../domain-model/_gen/physics_ir.json");
    
    let out_dir = env::var_os("OUT_DIR").unwrap();
    let json_path = Path::new("../domain-model/_gen/physics_ir.json");
    let json_str = fs::read_to_string(json_path).expect("IR not found");
    let ir: ConfigIR = serde_json::from_str(&json_str).expect("Invalid JSON");

    generate_phenotype(&ir, &out_dir);
    generate_physics(&ir, &out_dir);
}

// --------------------------------------------------------
// A. Phenotype Engine Generator (_gen_phenotype.rs)
// --------------------------------------------------------
fn generate_phenotype(ir: &ConfigIR, out_dir: &std::ffi::OsString) {
    let mut code = String::new();
    code.push_str("use candle_core::{Tensor, Result, Module};\n");
    code.push_str("use candle_nn::{Linear, VarBuilder, Activation};\n\n");

    // 出力構造体の定義
    code.push_str("pub struct PhenotypeOutput {\n");
    for (name, _) in &ir.groups {
        code.push_str(&format!("    pub {}: Tensor,\n", name));
    }
    code.push_str("}\n\n");

    // Engine構造体の定義
    code.push_str("pub struct PhenotypeEngine {\n");
    code.push_str("    base_net: candle_nn::Sequential,\n");
    for (name, _) in &ir.groups {
        code.push_str(&format!("    head_{}: Linear,\n", name));
    }
    code.push_str("}\n\n");

    // implブロック (new, forward)
    code.push_str("impl PhenotypeEngine {\n");
    
    // new関数
    code.push_str("    pub fn new(vs: VarBuilder, input_dim: usize, hidden_dim: usize) -> Result<Self> {\n");
    code.push_str("        let base_net = candle_nn::seq()\n");
    code.push_str("            .add(candle_nn::linear(input_dim, hidden_dim, vs.pp(\"base1\"))?)\n");
    code.push_str("            .add(Activation::Relu);\n");
    
    for (name, data) in &ir.groups {
        let size = data.params.len();
        code.push_str(&format!(
            "        let head_{0} = candle_nn::linear(hidden_dim, {1}, vs.pp(\"head_{0}\"))?;\n", 
            name, size
        ));
    }
    // ... 構造体初期化 ...
    code.push_str("    }\n");

    // forward関数
    code.push_str("    pub fn forward(&self, genes: &Tensor) -> Result<PhenotypeOutput> {\n");
    code.push_str("        let latent = self.base_net.forward(genes)?;\n");
    
    for (name, data) in &ir.groups {
        code.push_str(&format!("        let raw_{0} = self.head_{0}.forward(&latent)?;\n", name));
        match data.activation.as_str() {
            "softmax" => code.push_str(&format!("        let val_{0} = candle_nn::ops::softmax(&raw_{0}, 1)?;\n", name)),
            "tanh"    => code.push_str(&format!("        let val_{0} = raw_{0}.tanh()?;\n", name)),
            "sigmoid" => code.push_str(&format!("        let val_{0} = candle_nn::ops::sigmoid(&raw_{0})?;\n", name)),
            _         => code.push_str(&format!("        let val_{0} = raw_{0};\n", name)),
        }
    }

    code.push_str("        Ok(PhenotypeOutput {\n");
    for (name, _) in &ir.groups {
        code.push_str(&format!("            {}: val_{},\n", name, name));
    }
    code.push_str("        })\n");
    code.push_str("    }\n");
    code.push_str("}\n");

    fs::write(Path::new(out_dir).join("_gen_phenotype.rs"), code).unwrap();
}

// --------------------------------------------------------
// B. Physics Kernel Generator (_gen_physics.rs)
// --------------------------------------------------------
fn generate_physics(ir: &ConfigIR, out_dir: &std::ffi::OsString) {
    let mut code = String::new();
    code.push_str("use candle_core::{Tensor, Result};\n\n");

    // 関数のシグネチャ生成
    // fn update_physics(state: &Tensor, p_attributes: &Tensor, p_physics: &Tensor) -> ...
    let mut args = vec!["state: &Tensor".to_string()];
    for (name, _) in &ir.groups {
        args.push(format!("p_{}: &Tensor", name));
    }
    code.push_str(&format!("pub fn update_physics({}) -> Result<Tensor> {{\n", args.join(", ")));

    // 1. 状態変数の分解
    for (i, name) in ir.state_vars.iter().enumerate() {
        code.push_str(&format!("    let s_{} = state.narrow(1, {}, 1)?;\n", name, i));
    }

    // 2. パラメータの分解 (グループごと)
    for (g_name, g_data) in &ir.groups {
        for (i, p_name) in g_data.params.iter().enumerate() {
            code.push_str(&format!(
                "    let p_{} = p_{}.narrow(1, {}, 1)?;\n", 
                p_name, g_name, i
            ));
        }
    }

    // 3. 演算の適用
    for op in &ir.operations {
        // args解決ロジック (略: s_xx, p_yy, または中間変数 var_zz を判定して埋め込む)
        // 例: let var_temp1 = (s_vel_x * p_drag_coeff)?;
        let expr = format_op(op); 
        code.push_str(&format!("    let {} = {};\n", op.target, expr));
    }

    // 4. 結果の結合 (state_varsの順序通りに)
    code.push_str("    Tensor::cat(&[\n");
    for name in &ir.state_vars {
        // 更新された値があればそれ、なければ元の値(s_name)を使うロジック
        code.push_str(&format!("        &{},\n", resolve_final_var(name)));
    }
    code.push_str("    ], 1)\n");
    code.push_str("}\n");

    fs::write(Path::new(out_dir).join("_gen_physics.rs"), code).unwrap();
}
```

### `src/main.rs` (Main Entry)

自動生成されたモジュールを取り込み、実行します。

```rust
// 自動生成コードのインクルード
mod gen_phenotype {
    include!(concat!(env!("OUT_DIR"), "/_gen_phenotype.rs"));
}
mod gen_physics {
    include!(concat!(env!("OUT_DIR"), "/_gen_physics.rs"));
}

use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use gen_phenotype::PhenotypeEngine;
use gen_physics::update_physics;

fn main() -> anyhow::Result<()> {
    let device = Device::cuda_if_available(0)?;
    
    // 1. 初期化
    let n_agents = 1000;
    let gene_len = 32;
    let hidden_len = 64;
    
    let varmap = VarBuilder::zeros(candle_core::DType::F32, &device);
    let phenotype_engine = PhenotypeEngine::new(varmap.clone(), gene_len, hidden_len)?;

    // ランダムな遺伝子と状態
    let genes = Tensor::randn(0f32, 1f32, (n_agents, gene_len), &device)?;
    let mut state = Tensor::zeros((n_agents, 3), candle_core::DType::F32, &device)?; // pos, vel, energy

    // 2. シミュレーションループ
    for t in 0..100 {
        // A. 表現型発現 (Gene -> Params)
        // 戻り値は構造体 { attributes: Tensor, physics: Tensor }
        let params = phenotype_engine.forward(&genes)?;

        // B. 物理更新 (State + Params -> NewState)
        // ゼロコピーで構造体のフィールドを渡す
        let next_state = update_physics(
            &state, 
            &params.attributes, 
            &params.physics
        )?;

        state = next_state;
        
        // (ここで描画データの保存や、死亡判定・交叉などを行う)
    }

    Ok(())
}
```
