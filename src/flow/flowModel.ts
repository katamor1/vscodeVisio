import type { Node as SyntaxNode } from "web-tree-sitter";
import type { ParsedCSelection } from "../parser/cSelectionParser";

export type FlowNodeKind = "start" | "process" | "decision" | "terminator";

export interface FlowNode {
  readonly id: string;
  readonly kind: FlowNodeKind;
  readonly label: string;
  readonly source?: {
    readonly startIndex: number;
    readonly endIndex: number;
    readonly startLine: number;
    readonly endLine: number;
  };
}

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface FlowModel {
  readonly title: string;
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
}

type ExitKind = "normal" | "return" | "break" | "continue";

interface FlowExit {
  readonly from: string;
  readonly kind: ExitKind;
  readonly label?: string;
}

interface BuildContext {
  readonly title: string;
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
  nextId: number;
}

export function buildFlowModel(parsed: ParsedCSelection): FlowModel {
  const context: BuildContext = {
    title: parsed.functionName,
    nodes: [],
    edges: [],
    nextId: 1
  };

  const start = addNode(context, "start", `Start: ${parsed.functionName}`);
  const exits = appendStatements(context, compoundStatements(parsed.bodyNode), [{ from: start.id, kind: "normal" }]);
  const end = addNode(context, "terminator", "End");
  for (const exit of exits) {
    connect(context, exit.from, end.id, terminalEdgeLabel(exit.kind));
  }

  return {
    title: parsed.functionName,
    nodes: context.nodes,
    edges: context.edges
  };
}

export function countFlowSteps(flow: FlowModel): number {
  return flow.nodes.filter((node) => node.kind !== "start" && node.label !== "End").length;
}

function appendStatements(context: BuildContext, statements: SyntaxNode[], incoming: FlowExit[]): FlowExit[] {
  let pending = incoming;
  const carried: FlowExit[] = [];

  for (const statement of statements) {
    const normal = pending.filter((exit) => exit.kind === "normal");
    carried.push(...pending.filter((exit) => exit.kind !== "normal"));

    if (normal.length === 0) {
      const unreachable = appendStatement(context, statement, []);
      pending = unreachable;
    } else {
      pending = appendStatement(context, statement, normal);
    }
  }

  return [...pending, ...carried];
}

function appendStatement(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  switch (statement.type) {
    case "if_statement":
      return appendIf(context, statement, incoming);
    case "for_statement":
    case "while_statement":
      return appendLoop(context, statement, incoming);
    case "do_statement":
      return appendDoWhile(context, statement, incoming);
    case "switch_statement":
      return appendSwitch(context, statement, incoming);
    case "return_statement":
      return appendSimple(context, statement, incoming, "terminator", trimSemicolon(statement.text), "return");
    case "break_statement":
      return appendSimple(context, statement, incoming, "terminator", "break", "break");
    case "continue_statement":
      return appendSimple(context, statement, incoming, "terminator", "continue", "continue");
    case "compound_statement":
      return appendStatements(context, compoundStatements(statement), incoming);
    case "case_statement":
      return appendCaseBody(context, statement, incoming);
    default:
      return appendSimple(context, statement, incoming, "process", normalizeStatement(statement.text), "normal");
  }
}

function appendSimple(
  context: BuildContext,
  statement: SyntaxNode,
  incoming: FlowExit[],
  kind: FlowNodeKind,
  label: string,
  exitKind: ExitKind
): FlowExit[] {
  const node = addNode(context, kind, label, statement);
  connectIncoming(context, incoming, node.id);
  return [{ from: node.id, kind: exitKind }];
}

function appendIf(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const decision = addNode(context, "decision", `if ${conditionText(statement)}`, statement);
  connectIncoming(context, incoming, decision.id);

  const consequence = statement.childForFieldName("consequence");
  const alternative = statement.childForFieldName("alternative");
  const thenIncoming = [{ from: decision.id, kind: "normal" as const, label: "Yes" }];
  const thenExits = consequence ? appendStatement(context, consequence, thenIncoming) : thenIncoming;

  let elseExits: FlowExit[];
  if (alternative) {
    const elseBody = alternative.namedChildren[0];
    const elseIncoming = [{ from: decision.id, kind: "normal" as const, label: "No" }];
    elseExits = elseBody ? appendStatement(context, elseBody, elseIncoming) : elseIncoming;
  } else {
    elseExits = [{ from: decision.id, kind: "normal", label: "No" }];
  }

  return [...thenExits, ...elseExits];
}

function appendLoop(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const decision = addNode(context, "decision", loopLabel(statement), statement);
  connectIncoming(context, incoming, decision.id);

  const body = statement.childForFieldName("body");
  if (!body) {
    return [{ from: decision.id, kind: "normal" }];
  }

  const bodyExits = appendStatement(context, body, [{ from: decision.id, kind: "normal", label: "Yes" }]);

  const loopExits: FlowExit[] = [{ from: decision.id, kind: "normal", label: "No" }];
  for (const exit of bodyExits) {
    if (exit.kind === "normal" || exit.kind === "continue") {
      connect(context, exit.from, decision.id, exit.kind === "continue" ? "Continue" : "Next");
    } else if (exit.kind === "break") {
      loopExits.push({ from: exit.from, kind: "normal" });
    } else {
      loopExits.push(exit);
    }
  }

  return loopExits;
}

function appendDoWhile(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const body = statement.childForFieldName("body");
  if (!body) {
    const decision = addNode(context, "decision", loopLabel(statement), statement);
    connectIncoming(context, incoming, decision.id);
    return [{ from: decision.id, kind: "normal", label: "No" }];
  }

  const firstBodyIndex = context.nodes.length;
  const bodyExits = appendStatement(context, body, incoming);
  const firstBodyNode = context.nodes[firstBodyIndex];
  const decision = addNode(context, "decision", loopLabel(statement), statement);
  const loopExits: FlowExit[] = [{ from: decision.id, kind: "normal", label: "No" }];

  for (const exit of bodyExits) {
    if (exit.kind === "normal" || exit.kind === "continue") {
      connect(context, exit.from, decision.id, exit.kind === "continue" ? "Continue" : "Next");
    } else if (exit.kind === "break") {
      loopExits.push({ from: exit.from, kind: "normal" });
    } else {
      loopExits.push(exit);
    }
  }

  if (firstBodyNode) {
    connect(context, decision.id, firstBodyNode.id, "Yes");
  }

  return loopExits;
}

function appendSwitch(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const decision = addNode(context, "decision", `switch ${conditionText(statement)}`, statement);
  connectIncoming(context, incoming, decision.id);

  const body = statement.childForFieldName("body");
  const cases = body?.namedChildren.filter((child) => child.type === "case_statement") ?? [];
  if (cases.length === 0) {
    return [{ from: decision.id, kind: "normal" }];
  }

  const caseShapes = cases.map((caseNode) => {
    const label = caseLabel(caseNode);
    const caseShape = addNode(context, "process", label, caseNode);
    connect(context, decision.id, caseShape.id, label);
    return caseShape;
  });

  const exits: FlowExit[] = [];
  let fallthrough: FlowExit[] = [];
  for (const [index, caseNode] of cases.entries()) {
    const caseShape = caseShapes[index];
    connectIncoming(context, fallthrough, caseShape.id);
    const caseExits = appendCaseBody(context, caseNode, [{ from: caseShape.id, kind: "normal" }]);
    fallthrough = [];

    for (const exit of caseExits) {
      if (exit.kind === "break") {
        exits.push({ from: exit.from, kind: "normal" });
      } else if (exit.kind === "normal" && index < cases.length - 1) {
        fallthrough.push({ from: exit.from, kind: "normal", label: "Fallthrough" });
      } else {
        exits.push(exit);
      }
    }
  }
  return exits;
}

function appendCaseBody(context: BuildContext, caseNode: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  return appendStatements(context, caseBodyStatements(caseNode), incoming);
}

function addNode(context: BuildContext, kind: FlowNodeKind, label: string, source?: SyntaxNode): FlowNode {
  const node: FlowNode = {
    id: `n${context.nextId++}`,
    kind,
    label,
    ...(source
      ? {
          source: {
            startIndex: source.startIndex,
            endIndex: source.endIndex,
            startLine: source.startPosition.row + 1,
            endLine: source.endPosition.row + 1
          }
        }
      : {})
  };
  context.nodes.push(node);
  return node;
}

function connectIncoming(context: BuildContext, incoming: FlowExit[], to: string): void {
  for (const exit of incoming) {
    connect(context, exit.from, to, exit.label);
  }
}

function connect(context: BuildContext, from: string, to: string, label?: string): void {
  context.edges.push({ from, to, ...(label ? { label } : {}) });
}

function compoundStatements(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child) => child.isNamed);
}

function caseBodyStatements(caseNode: SyntaxNode): SyntaxNode[] {
  return caseNode.namedChildren.filter((child) => isStatementLike(child));
}

function isStatementLike(node: SyntaxNode): boolean {
  return node.type.endsWith("_statement") || node.type === "declaration";
}

function conditionText(statement: SyntaxNode): string {
  const condition = statement.childForFieldName("condition");
  return condition ? normalizeWhitespace(condition.text) : "(condition)";
}

function loopLabel(statement: SyntaxNode): string {
  if (statement.type === "do_statement") {
    return `do while ${conditionText(statement)}`;
  }
  if (statement.type === "for_statement") {
    const initializer = statement.childForFieldName("initializer")?.text ?? "";
    const condition = statement.childForFieldName("condition")?.text ?? "";
    const update = statement.childForFieldName("update")?.text ?? "";
    return `for (${normalizeWhitespace(initializer)} ${normalizeWhitespace(condition)}; ${normalizeWhitespace(update)})`;
  }
  return `while ${conditionText(statement)}`;
}

function caseLabel(caseNode: SyntaxNode): string {
  const colon = caseNode.text.indexOf(":");
  return normalizeWhitespace(colon >= 0 ? caseNode.text.slice(0, colon) : caseNode.text);
}

function terminalEdgeLabel(kind: ExitKind): string | undefined {
  if (kind === "return") {
    return "Return";
  }
  if (kind === "break") {
    return "Break";
  }
  if (kind === "continue") {
    return "Continue";
  }
  return undefined;
}

function normalizeStatement(text: string): string {
  return trimSemicolon(normalizeWhitespace(text));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimSemicolon(text: string): string {
  return normalizeWhitespace(text).replace(/;$/, "");
}
