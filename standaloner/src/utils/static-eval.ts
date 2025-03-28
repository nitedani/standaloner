import type { Node } from 'estree'; // Or use acorn's Node type if preferred

// Define a type for the context variables passed to the evaluator
type EvaluationVars = Record<string, any>;

/**
 * Attempts to statically evaluate an ESTree AST node to a string value.
 * Designed primarily for resolving file paths.
 * Returns the string value if evaluation is successful and results in a string,
 * otherwise returns undefined.
 *
 * @param node The AST node to evaluate.
 * @param vars Context variables (e.g., { __dirname: '/path/to/dir', path: path }).
 * @returns The evaluated string value or undefined.
 */
export function evaluateStaticPath(node: Node | null | undefined, vars: EvaluationVars = {}): string | undefined {
  if (!node) {
    return undefined;
  }

  // --- Visitor Functions ---

  const visitors: { [type: string]: (n: any) => string | undefined } = {
    Literal(n: { value: any }): string | undefined {
      return typeof n.value === 'string' ? n.value : undefined;
    },

    Identifier(n: { name: string }): string | undefined {
      // Only return if the variable exists and is a primitive suitable for paths
      if (Object.hasOwn(vars, n.name)) {
        const value = vars[n.name];
        if (typeof value === 'string' || typeof value === 'number') {
          return String(value);
        }
      }
      return undefined;
    },

    TemplateLiteral(n: { quasis: any[]; expressions: any[] }): string | undefined {
      let str = '';
      for (let i = 0; i < n.quasis.length; i++) {
        str += n.quasis[i].value.cooked;
        if (i < n.expressions.length) {
          const exprValue = evaluateStaticPath(n.expressions[i], vars);
          // If any part of the template is not static, the whole thing isn't
          if (exprValue === undefined) {
            return undefined;
          }
          str += exprValue;
        }
      }
      return str;
    },

    BinaryExpression(n: { operator: string; left: Node; right: Node }): string | undefined {
      // Only handle string concatenation (+)
      if (n.operator === '+') {
        const leftVal = evaluateStaticPath(n.left, vars);
        const rightVal = evaluateStaticPath(n.right, vars);
        // Both sides must evaluate to strings to concatenate
        if (leftVal !== undefined && rightVal !== undefined) {
          return leftVal + rightVal;
        }
      }
      return undefined;
    },

    MemberExpression(n: { object: Node; property: Node; computed: boolean }): string | undefined {
      const objectValue = evaluateStaticPath(n.object, vars);
      // Basic support for process.env.VAR - extend if needed
      if (objectValue === undefined && n.object.type === 'Identifier' && n.object.name === 'process') {
         if (n.property.type === 'Identifier' && !n.computed && n.property.name === 'env') {
             // Defer evaluation to the next level if accessing process.env itself
             // You might need to pass process.env into 'vars' for full evaluation
             return undefined; // Or handle specific env vars if passed in 'vars'
         }
      }
      // Cannot statically evaluate member access further in this simplified version
      return undefined;
    },

    CallExpression(n: { callee: Node; arguments: Node[] }): string | undefined {
      // Handle specific known functions like path.join
      const calleeValue = evaluateStaticPath(n.callee, vars);

      // Special case: path.join(__dirname, ...)
      if (n.callee.type === 'MemberExpression' &&
          n.callee.object.type === 'Identifier' && n.callee.object.name === 'path' && // Assumes 'path' is in scope/vars
          n.callee.property.type === 'Identifier' && n.callee.property.name === 'join' &&
          vars.path && typeof vars.path.join === 'function')
       {
          const args = n.arguments.map(arg => evaluateStaticPath(arg, vars));
          // If all arguments resolved statically to strings
          if (args.every(arg => typeof arg === 'string')) {
              // Use the actual path.join function
              return vars.path.join(...(args as string[]));
          }
      }
      // Add handling for `new URL(..., ...)` if needed, converting result to path string

      // Cannot evaluate other function calls statically
      return undefined;
    },

    // Add other node types if necessary (e.g., NewExpression for URL)
    // Default: Unhandled node types cannot be evaluated
    // SequenceExpression, AssignmentExpression etc. won't resolve to a simple string path
  };

  // --- Execution ---
  const visitor = visitors[node.type];
  if (visitor) {
    return visitor(node);
  }
  // If no visitor matches, the node type isn't supported for static path evaluation
  return undefined;
}
