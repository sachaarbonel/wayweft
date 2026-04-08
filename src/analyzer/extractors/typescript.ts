import path from "node:path";
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
} from "ts-morph";
import type { FunctionInfo } from "../../types";
import { normalizePath } from "../../utils/fs";

function getMaxDepth(node: Node, level = 0): number {
  const nestedBlocks = node
    .getChildren()
    .filter((child) =>
      [
        SyntaxKind.IfStatement,
        SyntaxKind.SwitchStatement,
        SyntaxKind.ForStatement,
        SyntaxKind.ForOfStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.WhileStatement,
        SyntaxKind.Block,
      ].includes(child.getKind()),
    );
  if (nestedBlocks.length === 0) {
    return level;
  }
  return Math.max(...nestedBlocks.map((child) => getMaxDepth(child, level + 1)));
}

function getFunctionName(fn: FunctionDeclaration | MethodDeclaration | ArrowFunction): string {
  if ("getName" in fn && typeof fn.getName === "function") {
    return fn.getName() ?? "<anonymous>";
  }
  return "<anonymous>";
}

export function extractTypescriptFunctions(
  sourceFile: SourceFile,
  rootDir: string,
  packageName?: string,
): FunctionInfo[] {
  const filePath = sourceFile.getFilePath();
  const functions: FunctionInfo[] = [];

  const pushInfo = (fn: FunctionDeclaration | MethodDeclaration | ArrowFunction) => {
    const body = fn.getBody();
    if (!body) return;

    const params = fn.getParameters();
    const booleanParams = params.filter((param) => {
      const typeNode = param.getTypeNode();
      return typeNode?.getText() === "boolean";
    });

    const branchCount = body
      .getDescendants()
      .filter((node: Node) =>
        [
          SyntaxKind.IfStatement,
          SyntaxKind.SwitchStatement,
          SyntaxKind.ConditionalExpression,
          SyntaxKind.ForStatement,
          SyntaxKind.ForOfStatement,
          SyntaxKind.ForInStatement,
          SyntaxKind.WhileStatement,
        ].includes(node.getKind()),
      ).length;

    const startPos = sourceFile.getLineAndColumnAtPos(fn.getStart());
    const endPos = sourceFile.getLineAndColumnAtPos(fn.getEnd());
    const lineCount = body.getEndLineNumber() - body.getStartLineNumber() + 1;

    functions.push({
      name: getFunctionName(fn),
      filePath,
      packageName,
      startLine: startPos.line,
      startColumn: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
      lineCount,
      parameterCount: params.length,
      parameterNames: params.map((p) => p.getName()),
      booleanParamNames: booleanParams.map((p) => p.getName()),
      hasBooleanParams: booleanParams.length > 0,
      maxNestingDepth: getMaxDepth(body),
      branchCount,
      bodyText: body.getText(),
      language: "typescript",
    });
  };

  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    pushInfo(fn);
  }
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    pushInfo(fn);
  }
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
    pushInfo(fn);
  }

  return functions;
}

export function getRelativePath(filePath: string, rootDir: string): string {
  return normalizePath(path.relative(rootDir, filePath));
}
