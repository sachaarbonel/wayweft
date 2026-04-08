import { readFileSync } from "node:fs";
import type { FunctionInfo } from "../../types";
import type { TreeSitterParser } from "../parsers/tree-sitter-parser";
import { makeRustQuery } from "../parsers/tree-sitter-parser";
import type { Language, QueryMatch } from "web-tree-sitter";

const FUNCTION_QUERY = `
(function_item
  name: (identifier) @name
  parameters: (parameters) @params
  body: (block) @body) @function
`;

const NESTING_NODE_TYPES = new Set([
  "if_expression",
  "match_expression",
  "loop_expression",
  "while_expression",
  "for_expression",
  "while_let_expression",
  "if_let_expression",
  "block",
]);

const BRANCH_NODE_TYPES = new Set([
  "if_expression",
  "if_let_expression",
  "match_arm",
  "while_expression",
  "while_let_expression",
  "for_expression",
  "loop_expression",
]);

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
}

function getMaxNestingDepth(node: TreeSitterNode, depth = 0): number {
  let max = depth;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const childDepth = NESTING_NODE_TYPES.has(child.type)
      ? getMaxNestingDepth(child, depth + 1)
      : getMaxNestingDepth(child, depth);
    if (childDepth > max) max = childDepth;
  }
  return max;
}

function countBranches(node: TreeSitterNode): number {
  let count = 0;
  if (BRANCH_NODE_TYPES.has(node.type)) {
    count += 1;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) count += countBranches(child);
  }
  return count;
}

function extractParams(paramsNode: TreeSitterNode): {
  names: string[];
  boolNames: string[];
  hasBool: boolean;
} {
  const names: string[] = [];
  const boolNames: string[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    if (child.type === "parameter") {
      const patternNode = child.childForFieldName("pattern");
      const typeNode = child.childForFieldName("type");
      const paramName = patternNode?.text ?? "";
      names.push(paramName);
      if (typeNode?.text === "bool") boolNames.push(paramName);
    } else if (child.type === "self_parameter" || child.type === "receiver") {
      names.push("self");
    }
  }

  return { names, boolNames, hasBool: boolNames.length > 0 };
}

export function extractRustFunctions(
  filePath: string,
  packageName: string | undefined,
  tsParser: TreeSitterParser,
): FunctionInfo[] {
  let code: string;
  try {
    code = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const tree = tsParser.parseRust(code);
  const lang = tsParser.getRustLanguage();
  const query = makeRustQuery(lang as Language, FUNCTION_QUERY);
  const matches = query.matches(tree.rootNode as Parameters<typeof query.matches>[0]);

  const functions: FunctionInfo[] = [];

  for (const match of matches as QueryMatch[]) {
    const funcCapture = match.captures.find((c) => c.name === "function");
    const nameCapture = match.captures.find((c) => c.name === "name");
    const paramsCapture = match.captures.find((c) => c.name === "params");
    const bodyCapture = match.captures.find((c) => c.name === "body");

    if (!funcCapture || !nameCapture || !bodyCapture) continue;

    const funcNode = funcCapture.node as unknown as TreeSitterNode;
    const bodyNode = bodyCapture.node as unknown as TreeSitterNode;
    const paramsNode = paramsCapture?.node as unknown as TreeSitterNode | undefined;

    const startLine = funcNode.startPosition.row + 1;
    const startColumn = funcNode.startPosition.column + 1;
    const endLine = funcNode.endPosition.row + 1;
    const endColumn = funcNode.endPosition.column + 1;
    const lineCount = endLine - startLine + 1;

    const { names: parameterNames, boolNames: booleanParamNames, hasBool: hasBooleanParams } = paramsNode
      ? extractParams(paramsNode)
      : { names: [], boolNames: [], hasBool: false };

    const maxNestingDepth = getMaxNestingDepth(bodyNode);
    const branchCount = countBranches(bodyNode);
    const bodyText = bodyNode.text;

    functions.push({
      name: nameCapture.node.text,
      filePath,
      packageName,
      startLine,
      startColumn,
      endLine,
      endColumn,
      lineCount,
      parameterCount: parameterNames.filter((n) => n !== "self").length,
      parameterNames,
      booleanParamNames,
      hasBooleanParams,
      maxNestingDepth,
      branchCount,
      bodyText,
      language: "rust",
    });
  }

  return functions;
}

export function extractRustImports(filePath: string, tsParser: TreeSitterParser): string[] {
  let code: string;
  try {
    code = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const tree = tsParser.parseRust(code);
  const imports: string[] = [];

  function walkForImports(node: TreeSitterNode) {
    if (node.type === "use_declaration") {
      imports.push(node.text.replace(/^use\s+/, "").replace(/;$/, "").trim());
    } else if (node.type === "mod_item") {
      const modName = node.childForFieldName("name");
      if (modName) {
        imports.push(`mod::${modName.text}`);
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkForImports(child);
    }
  }

  walkForImports(tree.rootNode as unknown as TreeSitterNode);
  return imports;
}
