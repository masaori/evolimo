// Compiler: TypeScript definitions -> JSON IR

import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DynamicsRule,
  Expression,
  InitializationIR,
  OutputIR,
  Operation,
  ParameterGroups,
  BoundaryCondition,
  GridConfig,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CompilerContext {
  tempVarCounter: number;
  operations: Operation[];
  varMap: Map<string, string>; // Expression hash -> variable name
}

// Generate unique temporary variable name
function getTempVar(ctx: CompilerContext): string {
  return `temp_${ctx.tempVarCounter++}`;
}

// Compile expression tree to flat operations
function compileExpression(expr: Expression, ctx: CompilerContext): string {
  // Create a simple hash of the expression for deduplication
  // For stencil, we need to include the kernel function in the hash
  let exprKey: string;
  if (expr.op === 'stencil') {
    // Use a custom serialization for stencil to include kernel
    exprKey = JSON.stringify({
      ...expr,
      kernel: expr.kernel.toString(),
    });
  } else {
    exprKey = JSON.stringify(expr);
  }

  // Check if already compiled
  const existing = ctx.varMap.get(exprKey);
  if (existing) {
    return existing;
  }

  let resultVar: string;

  switch (expr.op) {
    case 'ref_state':
      resultVar = `s_${expr.id}`;
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;

    case 'ref_param':
      resultVar = `p_${expr.id}`;
      ctx.operations.push({
        target: resultVar,
        op: 'ref_param',
        args: [],
        param_info: { name: expr.id, group: expr.group },
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;

    case 'ref_aux':
      // Interaction outputs or other externally-defined variables.
      resultVar = expr.id;
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;

    case 'const':
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'const',
        args: [],
        value: expr.value,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;

    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'lt':
    case 'gt':
    case 'ge': {
      const left = compileExpression(expr.left, ctx);
      const right = compileExpression(expr.right, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: expr.op,
        args: [left, right],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'where': {
      const cond = compileExpression(expr.cond, ctx);
      const trueVal = compileExpression(expr.trueVal, ctx);
      const falseVal = compileExpression(expr.falseVal, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'where',
        args: [cond, trueVal, falseVal],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'sqrt': {
      const val = compileExpression(expr.value, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'sqrt',
        args: [val],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'transpose': {
      const val = compileExpression(expr.value, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'transpose',
        args: [val],
        dim0: expr.dim0,
        dim1: expr.dim1,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'sum': {
      const val = compileExpression(expr.value, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'sum',
        args: [val],
        dim: expr.dim,
        keepdim: expr.keepdim,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'relu':
    case 'neg': {
      const val = compileExpression(expr.value, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: expr.op,
        args: [val],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'grid_scatter': {
      const val = compileExpression(expr.value, ctx);
      const x = compileExpression(expr.x, ctx);
      const y = compileExpression(expr.y, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'grid_scatter',
        args: [val, x, y],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'stencil': {
      const val = compileExpression(expr.value, ctx);

      if (!expr.kernel) {
        throw new Error(
          'Stencil operation missing kernel function. Ensure you are using the updated ops.stencil(grid, range, kernel) signature.'
        );
      }

      // Compile kernel
      const kernelCtx: CompilerContext = {
        tempVarCounter: 0,
        operations: [],
        varMap: new Map(),
      };

      // Define placeholders for kernel inputs
      // These will be provided by the runtime/generator as available variables in the kernel scope
      const centerExpr: Expression = { op: 'ref_aux', id: 'center' };
      const neighborExpr: Expression = { op: 'ref_aux', id: 'neighbor' };

      // Generate kernel expression tree
      const kernelResultExpr = expr.kernel(centerExpr, neighborExpr);

      // Compile kernel to operations
      const kernelResultVar = compileExpression(kernelResultExpr, kernelCtx);

      // We need to ensure the result is explicitly marked if it's just a reference
      // But for now, we assume the generator takes the last operation's target or we can add a specific return op?
      // Let's add a 'kernel_return' op to be explicit, or just rely on convention.
      // Convention: The result of the kernel is the variable returned by compileExpression.
      // We can append a move/alias op if we want to enforce a specific output name, but let's keep it simple.
      // We will store the result variable name in the stencil op args or a new property?
      // Actually, let's just add a final identity op to a known name 'result' if we want,
      // or just let the generator use `kernelResultVar`.
      // Let's add `kernel_result_var` to the operation definition? No, `Operation` is fixed.
      // Let's just append an identity op to make sure the result is in a specific variable?
      // Or better: The generator will look at `kernel_operations`.
      // We can add a dummy op `kernel_output` that takes `kernelResultVar`.

      kernelCtx.operations.push({
        target: 'kernel_output',
        op: 'ref_aux', // Reuse ref_aux or similar to just alias
        args: [kernelResultVar],
      });

      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'stencil',
        args: [val],
        stencil_range: expr.range,
        kernel_operations: kernelCtx.operations,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'grid_gather': {
      const val = compileExpression(expr.value, ctx);
      const x = compileExpression(expr.x, ctx);
      const y = compileExpression(expr.y, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'grid_gather',
        args: [val, x, y],
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'cat': {
      const args = expr.values.map((v) => compileExpression(v, ctx));
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'cat',
        args,
        dim: expr.dim,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    case 'slice': {
      const val = compileExpression(expr.value, ctx);
      resultVar = getTempVar(ctx);
      ctx.operations.push({
        target: resultVar,
        op: 'slice',
        args: [val],
        dim: expr.dim,
        start: expr.start,
        len: expr.len,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;
    }

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unknown expression type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// Compile all rules to IR
function compileRules(
  rules: DynamicsRule[],
  stateVarOrder: string[],
  simConstants: OutputIR['constants'],
  parameterGroups: ParameterGroups,
  boundaryConditions: BoundaryCondition[],
  initialization: InitializationIR,
  gridConfig?: GridConfig
): OutputIR {
  const ctx: CompilerContext = {
    tempVarCounter: 0,
    operations: [],
    varMap: new Map(),
  };

  // Collect state variables: include both targets and referenced states.
  const stateVarSet = new Set<string>();
  const updatedStates = new Set<string>();

  function collectStates(expr: Expression): void {
    if (expr.op === 'ref_state') {
      stateVarSet.add(expr.id);
      return;
    }
    if (expr.op === 'ref_param' || expr.op === 'ref_aux' || expr.op === 'const') {
      return;
    }
    if ('left' in expr && 'right' in expr) {
      collectStates(expr.left);
      collectStates(expr.right);
      return;
    }
    if ('value' in expr && typeof expr.value !== 'number') {
      collectStates(expr.value);
    }
    if ('x' in expr && typeof expr.x !== 'number') {
      collectStates(expr.x);
    }
    if ('y' in expr && typeof expr.y !== 'number') {
      collectStates(expr.y);
    }
  }

  for (const rule of rules) {
    updatedStates.add(rule.target_state);
    stateVarSet.add(rule.target_state);
    collectStates(rule.expr);
  }

  // Produce ordered list of state vars.
  const ordered: string[] = [];
  for (const name of stateVarOrder) {
    if (stateVarSet.has(name)) ordered.push(name);
  }
  for (const name of Array.from(stateVarSet).sort()) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  const stateVars = ordered;

  // Collect parameter groups and parameters
  const groups: OutputIR['groups'] = {};
  const paramsPerGroup = new Map<string, Set<string>>();

  for (const [_key, config] of Object.entries(parameterGroups)) {
    groups[config.name] = {
      activation: config.activation,
      params: [],
    };
    paramsPerGroup.set(config.name, new Set());
  }

  // First pass: collect all parameters
  function collectParams(expr: Expression): void {
    switch (expr.op) {
      case 'ref_param': {
        const groupSet = paramsPerGroup.get(expr.group);
        if (!groupSet) {
          throw new Error(`Unknown group: ${expr.group}`);
        }
        groupSet.add(expr.id);
        break;
      }
      case 'ref_aux':
      case 'ref_state':
      case 'const':
        break;
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'lt':
      case 'gt':
      case 'ge':
        collectParams(expr.left);
        collectParams(expr.right);
        break;
      case 'where':
        collectParams(expr.cond);
        collectParams(expr.trueVal);
        collectParams(expr.falseVal);
        break;
      case 'sqrt':
      case 'relu':
      case 'neg':
      case 'stencil':
      case 'transpose':
      case 'sum':
      case 'slice':
        collectParams(expr.value);
        if (expr.op === 'stencil' && expr.kernel) {
          // Collect params from kernel
          const centerExpr: Expression = { op: 'ref_aux', id: 'center' };
          const neighborExpr: Expression = { op: 'ref_aux', id: 'neighbor' };
          const kernelExpr = expr.kernel(centerExpr, neighborExpr);
          collectParams(kernelExpr);
        }
        break;
      case 'grid_scatter':
      case 'grid_gather':
        collectParams(expr.value);
        collectParams(expr.x);
        collectParams(expr.y);
        break;
      case 'cat':
        expr.values.forEach(collectParams);
        break;
    }
  }

  for (const rule of rules) {
    collectParams(rule.expr);
  }

  // Sort parameters for consistent ordering
  for (const [groupName, paramSet] of paramsPerGroup) {
    const group = groups[groupName];
    if (group) {
      group.params = Array.from(paramSet).sort();
    }
  }

  // Compile each rule
  for (const rule of rules) {
    const resultVar = compileExpression(rule.expr, ctx);
    // Add final assignment operation
    ctx.operations.push({
      target: rule.target_state,
      op: 'add', // Placeholder - will be interpreted as assignment
      args: [resultVar],
    });
  }

  // Pass through any state vars that were referenced but not updated by rules.
  for (const name of stateVars) {
    if (updatedStates.has(name)) continue;
    const passthrough = compileExpression({ op: 'ref_state', id: name }, ctx);
    ctx.operations.push({
      target: name,
      op: 'add',
      args: [passthrough],
    });
  }

  // Validate initialization coverage for state vars.
  for (const name of stateVars) {
    if (!(name in initialization.state)) {
      throw new Error(`INITIALIZATION.state is missing state var: ${name}`);
    }
  }

  return {
    state_vars: stateVars,
    constants: simConstants,
    groups,
    boundary_conditions: boundaryConditions,
    ...(gridConfig ? { grid_config: gridConfig } : {}),
    initialization,
    operations: ctx.operations,
  };
}

// Main compilation
async function main() {
  console.log('🔧 Compiling TypeScript definitions to JSON IR...');

  const definitionsDir = join(__dirname, 'definitions');
  const files = readdirSync(definitionsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

  for (const file of files) {
    const name = basename(file, extname(file));
    console.log(`   Processing definition: ${name}`);

    const modulePath = join(definitionsDir, file);
    const mod = await import(modulePath);

    const {
      BOUNDARY_CONDITIONS,
      INITIALIZATION,
      PARAMETER_GROUPS,
      DYNAMICS_RULES,
      STATE_VAR_ORDER,
      VISUAL_MAPPING,
      SIM_CONSTANTS,
      GRID_CONFIG,
    } = mod;

    const ir = compileRules(
      DYNAMICS_RULES,
      STATE_VAR_ORDER,
      SIM_CONSTANTS,
      PARAMETER_GROUPS,
      BOUNDARY_CONDITIONS,
      INITIALIZATION,
      GRID_CONFIG
    );

    const outputDir = join(__dirname, '../_gen', name);
    mkdirSync(outputDir, { recursive: true });

    const outputPath = join(outputDir, 'dynamics_ir.json');
    writeFileSync(outputPath, JSON.stringify(ir, null, 2), 'utf-8');

    const visualPath = join(outputDir, 'visual_mapping.json');
    writeFileSync(visualPath, JSON.stringify(VISUAL_MAPPING, null, 2), 'utf-8');

    console.log(`   ✅ Generated: ${outputPath}`);
  }
}

main();
