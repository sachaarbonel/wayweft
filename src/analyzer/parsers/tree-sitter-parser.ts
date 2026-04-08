import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Parser, Language, Query } from "web-tree-sitter";

const require = createRequire(import.meta.url);

let initialized = false;
let rustLanguage: Language | null = null;

export interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
}

export interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

export interface TreeSitterParser {
  parseRust(code: string): TreeSitterTree;
  getRustLanguage(): Language;
}

async function initializeTreeSitter(): Promise<void> {
  if (initialized) return;
  const webTreeSitterDir = path.dirname(require.resolve("web-tree-sitter"));
  await Parser.init({
    locateFile: (scriptName: string) => path.join(webTreeSitterDir, scriptName),
  });
  initialized = true;
}

async function loadRustLanguage(): Promise<Language> {
  if (rustLanguage) return rustLanguage;
  const rustWasmPath = path.join(
    path.dirname(require.resolve("tree-sitter-rust/package.json")),
    "tree-sitter-rust.wasm",
  );
  rustLanguage = await Language.load(readFileSync(rustWasmPath));
  return rustLanguage;
}

export async function createTreeSitterParser(): Promise<TreeSitterParser> {
  await initializeTreeSitter();
  const lang = await loadRustLanguage();

  const parser = new Parser();
  parser.setLanguage(lang);

  return {
    parseRust(code: string): TreeSitterTree {
      return parser.parse(code) as unknown as TreeSitterTree;
    },
    getRustLanguage(): Language {
      return lang;
    },
  };
}

export function makeRustQuery(language: Language, source: string): Query {
  return new Query(language, source);
}
