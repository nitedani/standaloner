// utils/static-eval.ts
import type { Node } from 'estree';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

type EvaluationVars = {
    __dirname?: string;
    'import.meta.url'?: string; 
    [key: string]: any;
};

type InternalEvalResult = string | URL | undefined;
type InternalVisitor = (n: any, recurse: (node: Node | null | undefined) => InternalEvalResult) => InternalEvalResult;

function _evaluateInternal(node: Node | null | undefined, vars: EvaluationVars): InternalEvalResult {
  if (!node) return undefined;

  const visitors: { [type: string]: InternalVisitor } = {
    Literal: (n: { value: any }): InternalEvalResult => (typeof n.value === 'string' ? n.value : undefined),

    Identifier: (n: { name: string }): InternalEvalResult => {
      if (Object.hasOwn(vars, n.name)) {
        const value = vars[n.name];
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        if (value instanceof URL) return value; // Allow URL objects from vars
      }
      return undefined;
    },

    TemplateLiteral: (n: { quasis: any[]; expressions: any[] }, recurse): InternalEvalResult => {
      let str = '';
      for (let i = 0; i < n.quasis.length; i++) {
        str += n.quasis[i].value.cooked;
        if (i < n.expressions.length) {
          const exprNode = n.expressions[i];
          if (!exprNode) return undefined; // Handle sparse arrays/errors
          const exprValue = recurse(exprNode);
          if (typeof exprValue !== 'string') return undefined; // Non-static or URL part
          str += exprValue;
        }
      }
      return str;
    },

    BinaryExpression: (n: { operator: string; left: Node; right: Node }, recurse): InternalEvalResult => {
      if (n.operator === '+') { // String concatenation only
        const leftVal = recurse(n.left);
        const rightVal = recurse(n.right);
        if (typeof leftVal === 'string' && typeof rightVal === 'string') {
          return leftVal + rightVal;
        }
      }
      return undefined;
    },

    MemberExpression: (n: { object: Node; property: Node; computed: boolean }, _recurse): InternalEvalResult => {
      // Handle import.meta.url
      if (n.object.type === 'MetaProperty' &&
          n.object.meta.name === 'import' &&
          n.object.property.name === 'meta' &&
          n.property.type === 'Identifier' && !n.computed &&
          n.property.name === 'url')
      {
        return typeof vars['import.meta.url'] === 'string' ? vars['import.meta.url'] : undefined;
      }

      return undefined; // Other member expressions not evaluated
    },

    CallExpression: (n: { callee: Node; arguments: (Node | null)[] }, recurse): InternalEvalResult => {
      // path.join(...)
      if (n.callee.type === 'MemberExpression' &&
          n.callee.object.type === 'Identifier' && n.callee.object.name === 'path' &&
          n.callee.property.type === 'Identifier' && n.callee.property.name === 'join')
          // Check if path.join exists in vars
      {
          const args = (n.arguments || []).map(arg => recurse(arg));
          if (args.every(arg => typeof arg === 'string')) {
              // Use the actual path.join function provided in vars
              return path.join(...(args as string[]));
          }
      }
      // fileURLToPath(...)
      else if (n.callee.type === 'Identifier' && n.callee.name === 'fileURLToPath' && n.arguments.length === 1) {
          const argNode = n.arguments[0];
          if (!argNode) return undefined; // Check argument existence
          const argValue = recurse(argNode); // Evaluate argument

          if (argValue instanceof URL) { // If arg evaluated to a URL object
              try { return fileURLToPath(argValue); } catch { return undefined; } // Convert URL obj -> path string
          }
          if (typeof argValue === 'string' && argValue.startsWith('file:')) { // If arg evaluated to a file: string
              try { return fileURLToPath(argValue); } catch { return undefined; } // Convert file: string -> path string
          }
      }
      return undefined; // Other function calls not evaluated
    },

    NewExpression: (n: { callee: Node; arguments: (Node | null)[] }, recurse): InternalEvalResult => { // Returns URL | undefined
      // new URL(pathStr, baseStr)
      if (n.callee.type === 'Identifier' && n.callee.name === 'URL' && n.arguments.length === 2) {
        const firstArgNode = n.arguments[0];
        const secondArgNode = n.arguments[1];
        if (!firstArgNode || !secondArgNode) return undefined; // Check arguments existence

        const firstArg = recurse(firstArgNode); // The relative path string
        const secondArg = recurse(secondArgNode); // The base URL string (e.g., import.meta.url value)

        // Ensure base is a file: URL string before constructing
        if (typeof firstArg === 'string' && typeof secondArg === 'string' && secondArg.startsWith('file:')) {
          try { return new URL(firstArg, secondArg); } catch { return undefined; } // Return the URL object
        }
      }
      return undefined;
    },
  };

  // --- Internal Execution ---
  const visitor = visitors[node.type];
  if (visitor) {
    // Pass the internal evaluation function for recursion
    return visitor(node, (childNode) => _evaluateInternal(childNode, vars));
  }
  return undefined; // Node type not handled
}

export function evaluateStaticPath(node: Node | null | undefined, vars: EvaluationVars = {}): string | undefined {
    const result = _evaluateInternal(node, vars);
    // Ensure the final result exposed by this public function is strictly a string
    return typeof result === 'string' ? result : undefined;
}