// Compiler: TypeScript definitions -> JSON IR

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Expression, PhysicsRule, OutputIR, Operation } from './types.js';
import { PARAMETER_GROUPS, PHYSICS_RULES, extractStateVars, VISUAL_MAPPING } from './definition.js';

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
function compileRules(rules: PhysicsRule[]): OutputIR {
  const ctx: CompilerContext = {
    tempVarCounter: 0,
    operations: [],
    varMap: new Map(),
  };

  // Collect state variables
  const stateVars = extractStateVars(rules);

  // Collect parameter groups and parameters
  const groups: OutputIR['groups'] = {};
  const paramsPerGroup = new Map<string, Set<string>>();

  for (const [_key, config] of Object.entries(PARAMETER_GROUPS)) {
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

  return {
    state_vars: stateVars,
    groups,
    operations: ctx.operations,
  };
}

// Main compilation
function main(): void {
  console.log('🔧 Compiling TypeScript definitions to JSON IR...');

  const ir = compileRules(PHYSICS_RULES);

  const outputPath = join(__dirname, '../_gen/physics_ir.json');
  writeFileSync(outputPath, JSON.stringify(ir, null, 2), 'utf-8');

  console.log('✅ Generated:', outputPath);
  console.log(`   - State variables: ${ir.state_vars.length}`);
  console.log(`   - Parameter groups: ${Object.keys(ir.groups).length}`);
  console.log(`   - Operations: ${ir.operations.length}`);

  // Export visual mapping configuration
  const visualPath = join(__dirname, '../_gen/visual_mapping.json');
  writeFileSync(visualPath, JSON.stringify(VISUAL_MAPPING, null, 2), 'utf-8');
  console.log('✅ Generated:', visualPath);
}

main();
