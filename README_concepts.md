# Evolimo Architecture & Concept

## 1. Project Overview
本プロジェクトは、**「物理法則と生物学的特性を宣言的に定義し、Rust + Candle (Tensor Framework) で高速に実行する」** 生物進化シミュレーターです。

従来のシミュレーターのようにロジックをRustコードにハードコードするのではなく、TypeScriptで記述された「定義ファイル」から計算グラフを自動生成するアーキテクチャを採用します。

### Key Concepts
1. **Declarative Physics (宣言的物理演算):**
   * 移動、代謝、減衰などの物理法則は TypeScript 上の DSL で記述する。
   * Rust側はそれを解釈するのではなく、コンパイル時生成されたネイティブコードとして実行する。

2. **Tensor-First Simulation:**
   * 個体（Agent）をオブジェクトとして扱わず、巨大なテンソルの「行（Row）」として扱う。
   * すべての計算は行列演算（SIMD/GPU）で行われるため、数万〜数十万個体のシミュレーションが可能。

3. **Genotype to Phenotype Mapping:**
   * 遺伝子（Genotype）は直接パラメータにならず、Neural Network (Phenotype Engine) を経由して物理パラメータ（Phenotype）に変換される。
   * これにより「トレードオフ」や「多面発現」といった生物学的複雑性を表現する。

---

## 2. Architecture Pipeline

開発フローは **"Define (TS) -> Compile (JSON) -> Generate (Rust) -> Run"** のパイプラインで構成されます。

### Mermaid 図（内部コードブロックを ``` でエスケープ済み）

```mermaid
flowchart TD
    subgraph "Domain Model (TypeScript)"
        DEF[definition.ts<br/>(Physics & Params Rules)]
        SCHEMA[schema.ts<br/>(DSL & Types)]
        GEN_SCRIPT[generate_json.ts]
        
        DEF --> GEN_SCRIPT
        SCHEMA --> GEN_SCRIPT
    end

    subgraph "Intermediate Representation"
        JSON[physics_ir.json<br/>(Computed Graph & Schema)]
    end

    subgraph "Simulator (Rust)"
        BUILD[build.rs<br/>(Code Generator)]
        GEN_RS_PHENO[generated_phenotype.rs]
        GEN_RS_PHYS[generated_physics.rs]
        MAIN[main.rs<br/>(Simulation Loop)]
        CANDLE[Candle Framework]
    end

    GEN_SCRIPT -->|Generate| JSON
    JSON -->|Read| BUILD
    BUILD -->|Generate| GEN_RS_PHENO
    BUILD -->|Generate| GEN_RS_PHYS
    GEN_RS_PHENO --> MAIN
    GEN_RS_PHYS --> MAIN
    CANDLE --> MAIN
```

---

## 3. Data Flow & Layers

シミュレーションは以下のレイヤーでデータが変換されます。

### **Layer 1: Genotype (遺伝子)**
**Data:** `Tensor (N_individuals, Gene_Length)`  
Static: シミュレーション中は不変（次世代生成時のみ変化）。

---

### **Layer 2: Phenotype Engine (発現)**
**Logic:** MLP (Multi-Layer Perceptron).  
**Process:** 遺伝子テンソルを入力とし、**パラメータグループ**ごとに出力する。

- **Attributes Group (Softmax)**
- **Physics Group (Tanh)**

---

### **Layer 3: Physics Kernel (物理演算)**

```text
pos_x += vel_x * dt
energy -= metabolism * dt
```

---

## 4. Directory Structure (Monorepo)

```text
root/
├── domain-model/
│   ├── src/
│   │   ├── definition.ts
│   │   └── schema.ts
│   ├── scripts/
│   │   └── generate.ts
│   └── _gen/
│
├── simulator/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs
│   ├── build.rs
│   └── Cargo.toml
│
└── visualizer/
```

---

## 5. Implementation Strategy

### Phase 1
- DSL の実装  
- IR(JSON) の生成  

### Phase 2
- Rust の build.rs でコード生成  

### Phase 3
- `main.rs` に include して実行ループ構築

---
