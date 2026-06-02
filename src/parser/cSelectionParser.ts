import path from "node:path";
import { Language, Parser, type Node as SyntaxNode, type Tree } from "web-tree-sitter";

export type ParseMode =
  | { mode: "selection" }
  | { mode: "document"; cursorOffset: number };

export interface ParsedCSelection {
  readonly originalSource: string;
  readonly parseSource: string;
  readonly tree: Tree;
  readonly rootNode: SyntaxNode;
  readonly functionNode: SyntaxNode;
  readonly bodyNode: SyntaxNode;
  readonly syntheticWrapper: boolean;
  readonly functionName: string;
  readonly functionSignature: string;
}

let parserPromise: Promise<Parser> | undefined;

export async function parseCSelection(source: string, options: ParseMode): Promise<ParsedCSelection> {
  const parser = await getParser();
  if (options.mode === "document") {
    const tree = parseOrThrow(parser, source);
    const functionNode = findContainingFunction(tree.rootNode, options.cursorOffset);
    if (!functionNode) {
      throw new Error("No C function definition contains the current cursor position.");
    }
    const bodyNode = requireBody(functionNode);
    return {
      originalSource: source,
      parseSource: source,
      tree,
      rootNode: tree.rootNode,
      functionNode,
      bodyNode,
      syntheticWrapper: false,
      functionName: getFunctionName(functionNode) ?? "selected_function",
      functionSignature: getFunctionSignature(functionNode) ?? "selected_function"
    };
  }

  const directTree = parser.parse(source);
  if (directTree && !directTree.rootNode.hasError) {
    const directFunction = findSingleFunctionDefinition(directTree.rootNode);
    if (directFunction) {
      return {
        originalSource: source,
        parseSource: source,
        tree: directTree,
        rootNode: directTree.rootNode,
        functionNode: directFunction,
        bodyNode: requireBody(directFunction),
        syntheticWrapper: false,
        functionName: getFunctionName(directFunction) ?? "selected_function",
        functionSignature: getFunctionSignature(directFunction) ?? "selected_function"
      };
    }
  }

  const wrappedSource = `void __selected_fragment(void) {\n${source}\n}\n`;
  const wrappedTree = parseOrThrow(parser, wrappedSource);
  const wrappedFunction = findSingleFunctionDefinition(wrappedTree.rootNode);
  if (!wrappedFunction) {
    throw new Error("Selected C fragment could not be parsed as a function body.");
  }

  return {
    originalSource: source,
    parseSource: wrappedSource,
    tree: wrappedTree,
    rootNode: wrappedTree.rootNode,
    functionNode: wrappedFunction,
    bodyNode: requireBody(wrappedFunction),
    syntheticWrapper: true,
    functionName: "__selected_fragment",
    functionSignature: getFunctionSignature(wrappedFunction) ?? "void __selected_fragment(void)"
  };
}

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init({
        locateFile(fileName: string) {
          if (fileName.endsWith(".wasm")) {
            return require.resolve(path.join("web-tree-sitter", "web-tree-sitter.wasm"));
          }
          return fileName;
        }
      });
      const language = await Language.load(require.resolve(path.join("tree-sitter-c", "tree-sitter-c.wasm")));
      const parser = new Parser();
      parser.setLanguage(language);
      return parser;
    })();
  }
  return parserPromise;
}

function parseOrThrow(parser: Parser, source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("Tree-sitter returned no parse tree.");
  }
  if (tree.rootNode.hasError) {
    throw new Error("Selected C code contains syntax errors that prevent flowchart generation.");
  }
  return tree;
}

function findSingleFunctionDefinition(rootNode: SyntaxNode): SyntaxNode | undefined {
  const functions = rootNode.namedChildren.filter((child) => child.type === "function_definition");
  return functions.length === 1 ? functions[0] : undefined;
}

function findContainingFunction(rootNode: SyntaxNode, cursorOffset: number): SyntaxNode | undefined {
  const stack = [...rootNode.namedChildren];
  let best: SyntaxNode | undefined;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === "function_definition" && node.startIndex <= cursorOffset && cursorOffset <= node.endIndex) {
      best = node;
    }
    stack.push(...node.namedChildren);
  }
  return best;
}

function requireBody(functionNode: SyntaxNode): SyntaxNode {
  const body = functionNode.childForFieldName("body");
  if (!body || body.type !== "compound_statement") {
    throw new Error("Selected C function has no compound statement body.");
  }
  return body;
}

function getFunctionName(functionNode: SyntaxNode): string | undefined {
  const declarator = functionNode.childForFieldName("declarator");
  if (!declarator) {
    return undefined;
  }
  const stack = [declarator];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }
    if (node.type === "identifier") {
      return node.text;
    }
    stack.push(...node.namedChildren);
  }
  return undefined;
}

function getFunctionSignature(functionNode: SyntaxNode): string | undefined {
  const body = functionNode.childForFieldName("body");
  if (!body) {
    return undefined;
  }
  const signatureLength = body.startIndex - functionNode.startIndex;
  if (signatureLength <= 0) {
    return undefined;
  }
  return normalizeWhitespace(functionNode.text.slice(0, signatureLength));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
