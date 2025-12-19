// Compiler: TypeScript definitions -> JSON IR

import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DynamicsRule, Expression, InitializationIR, OutputIR, Operation, ParameterGroups, BoundaryCondition } from './types.js';

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
  const exprKey = JSON.stringify(expr);

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
        value: expr.value,
      });
      ctx.varMap.set(exprKey, resultVar);
      return resultVar;

    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
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
  simConstants: any,
  parameterGroups: ParameterGroups,
  boundaryConditions: BoundaryCondition[],
  initialization: InitializationIR
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
    if (expr.op === 'ref_param') {
      const groupSet = paramsPerGroup.get(expr.group);
      if (!groupSet) {
        throw new Error(`Unknown group: ${expr.group}`);
      }
      groupSet.add(expr.id);
    } else if (expr.op === 'ref_aux' || expr.op === 'ref_state' || expr.op === 'const') {
      return;
    } else if ('left' in expr && 'right' in expr) {
      collectParams(expr.left);
      collectParams(expr.right);
    } else if ('value' in expr && typeof expr.value !== 'number') {
      collectParams(expr.value);
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
    initialization,
    operations: ctx.operations,
  };
}

// Main compilation
async function main() {
  console.log('🔧 Compiling TypeScript definitions to JSON IR...');

  const definitionsDir = join(__dirname, 'definitions');
  const files = readdirSync(definitionsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));

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
    } = mod;

    const ir = compileRules(
      DYNAMICS_RULES,
      STATE_VAR_ORDER,
      SIM_CONSTANTS,
      PARAMETER_GROUPS,
      BOUNDARY_CONDITIONS,
      INITIALIZATION
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
