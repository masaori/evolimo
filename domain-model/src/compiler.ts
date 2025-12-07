/**
 * Compiler that converts TypeScript DSL definitions to JSON IR
 */

import * as fs from 'fs';
import * as path from 'path';
import { Expression, GroupConfig, PhysicsRule } from './builder';
import { GROUPS, rules, STATE_VARS } from './definition';

// Output JSON structure
interface OutputIR {
  state_vars: string[];
  groups: {
    [groupName: string]: {
      activation: string;
      params: string[];
    };
  };
  operations: Array<{
    target: string;
    op: string;
    args: string[];
  }>;
}

// Intermediate operation representation
interface Operation {
  target: string;
  op: string;
  args: string[];
}

// Helper to extract all parameter names from an expression
function extractParams(expr: Expression, params: Set<string>): void {
  if (expr.op === 'ref_param') {
    params.add(expr.id);
  } else if ('left' in expr && 'right' in expr) {
    extractParams(expr.left, params);
    extractParams(expr.right, params);
  } else if ('value' in expr && typeof expr.value !== 'number') {
    extractParams(expr.value, params);
  }
}

// Convert expression tree to flat operations
function flattenExpression(
  expr: Expression,
  operations: Operation[],
  varCounter: { count: number }
): string {
  switch (expr.op) {
    case 'ref_state':
      return `s_${expr.id}`;
    
    case 'ref_param':
      return `p_${expr.id}`;
    
    case 'const':
      const constVar = `const_${varCounter.count++}`;
      operations.push({
        target: constVar,
        op: 'const',
        args: [expr.value.toString()]
      });
      return constVar;
    
    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
      const left = flattenExpression(expr.left, operations, varCounter);
      const right = flattenExpression(expr.right, operations, varCounter);
      const resultVar = `var_${varCounter.count++}`;
      operations.push({
        target: resultVar,
        op: expr.op,
        args: [left, right]
      });
      return resultVar;
    }
    
    case 'relu': {
      const value = flattenExpression(expr.value, operations, varCounter);
      const resultVar = `var_${varCounter.count++}`;
      operations.push({
        target: resultVar,
        op: 'relu',
        args: [value]
      });
      return resultVar;
    }
    
    default:
      throw new Error(`Unknown operation: ${(expr as any).op}`);
  }
}

// Compile definitions to IR
function compile(): OutputIR {
  // Build groups structure with parameter ordering
  const groupsOutput: OutputIR['groups'] = {};
  const paramToGroup = new Map<string, string>();
  
  // First pass: collect all parameters from rules
  const allParams = new Set<string>();
  for (const rule of rules) {
    extractParams(rule.expr, allParams);
  }
  
  // Second pass: organize parameters by group
  for (const [key, config] of Object.entries(GROUPS)) {
    const groupParams: string[] = [];
    
    for (const paramName of allParams) {
      // Check if this parameter belongs to this group by checking all rules
      for (const rule of rules) {
        checkParamGroup(rule.expr, paramName, config.name, groupParams, paramToGroup);
      }
    }
    
    groupsOutput[config.name] = {
      activation: config.activation,
      params: Array.from(new Set(groupParams)) // Remove duplicates
    };
  }
  
  // Third pass: flatten all rule expressions to operations
  const operations: Operation[] = [];
  const varCounter = { count: 0 };
  
  for (const rule of rules) {
    const resultVar = flattenExpression(rule.expr, operations, varCounter);
    
    // Final assignment to target state
    operations.push({
      target: `s_${rule.target_state}_next`,
      op: 'assign',
      args: [resultVar]
    });
  }
  
  return {
    state_vars: STATE_VARS,
    groups: groupsOutput,
    operations
  };
}

// Helper to check if a parameter belongs to a specific group
function checkParamGroup(
  expr: Expression,
  paramName: string,
  groupName: string,
  groupParams: string[],
  paramToGroup: Map<string, string>
): void {
  if (expr.op === 'ref_param' && expr.id === paramName && expr.group === groupName) {
    if (!groupParams.includes(paramName)) {
      groupParams.push(paramName);
      paramToGroup.set(paramName, groupName);
    }
  } else if ('left' in expr && 'right' in expr) {
    checkParamGroup(expr.left, paramName, groupName, groupParams, paramToGroup);
    checkParamGroup(expr.right, paramName, groupName, groupParams, paramToGroup);
  } else if ('value' in expr && typeof expr.value !== 'number') {
    checkParamGroup(expr.value, paramName, groupName, groupParams, paramToGroup);
  }
}

// Main execution
function main() {
  console.log('Compiling physics definitions to JSON IR...');
  
  const ir = compile();
  
  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, '..', '_gen');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write JSON output
  const outputPath = path.join(outputDir, 'physics_ir.json');
  fs.writeFileSync(outputPath, JSON.stringify(ir, null, 2));
  
  console.log(`✓ Generated: ${outputPath}`);
  console.log(`  - State variables: ${ir.state_vars.length}`);
  console.log(`  - Parameter groups: ${Object.keys(ir.groups).length}`);
  console.log(`  - Operations: ${ir.operations.length}`);
}

// Run if called directly
if (require.main === module) {
  main();
}

export { compile, OutputIR };
