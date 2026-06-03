import type { Node as SyntaxNode } from "web-tree-sitter";
import type { ParsedCSelection } from "../parser/cSelectionParser";

export type FlowNodeKind = "start" | "process" | "decision" | "terminator";

export interface FlowNode {
  readonly id: string;
  readonly kind: FlowNodeKind;
  readonly label: string;
  readonly comment?: string;
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
  readonly fromPort: FlowFromPort;
  readonly toPort: FlowToPort;
  readonly label?: string;
  readonly routeNode?: FlowRouteNode;
  readonly labelPosition?: FlowLabelPosition;
}

export interface FlowLabelPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlowRouteNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly orientation: FlowRouteOrientation;
  readonly inPort: FlowRoutePort;
  readonly outPort: FlowRoutePort;
}

export type FlowRouteOrientation = "vertical" | "horizontal";
export type FlowRoutePort = "top" | "bottom" | "left" | "right";
export type FlowFromPort = "bottom" | "right" | "left";
export type FlowToPort = "top";

export interface FlowGroup {
  readonly id: string;
  readonly kind: "loopBody";
  readonly label: string;
  readonly ownerNodeId: string;
  readonly nodeIds: string[];
}

export interface FlowModel {
  readonly title: string;
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
  readonly groups: FlowGroup[];
}

type ExitKind = "normal" | "return" | "break" | "continue";

interface FlowExit {
  readonly from: string;
  readonly kind: ExitKind;
  readonly label?: string;
  readonly fromPort?: FlowFromPort;
  readonly toPort?: FlowToPort;
}

interface BuildContext {
  readonly title: string;
  readonly nodes: FlowNode[];
  readonly edges: FlowEdge[];
  readonly groups: FlowGroup[];
  readonly comments: SourceComment[];
  readonly sourceLines: string[];
  nextId: number;
  nextGroupId: number;
}

interface AddNodeOptions {
  readonly commentSource?: SyntaxNode;
  readonly suppressComment?: boolean;
}

interface AppendStatementsOptions {
  readonly allowDisconnectedFirstStatement?: boolean;
  readonly insideLoopBody?: boolean;
}

interface SourceComment {
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
}

export function buildFlowModel(parsed: ParsedCSelection): FlowModel {
  const context: BuildContext = {
    title: parsed.functionName,
    nodes: [],
    edges: [],
    groups: [],
    comments: collectComments(parsed.rootNode),
    sourceLines: parsed.parseSource.split(/\r?\n/),
    nextId: 1,
    nextGroupId: 1
  };

  const startLabel = parsed.syntheticWrapper ? `Start: ${parsed.functionName}` : parsed.functionSignature;
  const start = addNode(context, "start", startLabel);
  const exits = appendStatements(context, compoundStatements(parsed.bodyNode), [{ from: start.id, kind: "normal" }]);
  const end = addNode(context, "terminator", parsed.syntheticWrapper ? "End" : "return");
  for (const exit of exits) {
    if (exit.kind === "return") {
      continue;
    }
    connect(context, exit.from, end.id, terminalEdgeLabel(exit.kind) ?? exit.label, exit.fromPort, exit.toPort);
  }

  return {
    title: parsed.functionName,
    nodes: context.nodes,
    edges: context.edges,
    groups: context.groups
  };
}

export function countFlowSteps(flow: FlowModel): number {
  return flow.nodes.filter((node) => node.kind !== "start" && !(node.kind === "terminator" && !node.source)).length;
}

function appendStatements(
  context: BuildContext,
  statements: SyntaxNode[],
  incoming: FlowExit[],
  options: AppendStatementsOptions = {}
): FlowExit[] {
  let pending = incoming;
  const carried: FlowExit[] = [];
  let disconnectedStartUsed = false;

  for (const statement of statements) {
    const normal = pending.filter((exit) => exit.kind === "normal");
    carried.push(...pending.filter((exit) => exit.kind !== "normal"));

    if (normal.length === 0) {
      if (!disconnectedStartUsed && options.allowDisconnectedFirstStatement) {
        pending = appendStatement(context, statement, [], { allowDisconnectedFirstStatement: true });
        disconnectedStartUsed = true;
      } else {
        pending = [];
      }
    } else {
      pending = appendStatement(context, statement, normal, options);
      disconnectedStartUsed = true;
    }
  }

  return [...pending, ...carried];
}

function appendStatement(
  context: BuildContext,
  statement: SyntaxNode,
  incoming: FlowExit[],
  options: AppendStatementsOptions = {}
): FlowExit[] {
  switch (statement.type) {
    case "if_statement":
      return appendIf(context, statement, incoming, options);
    case "for_statement":
      return appendForLoop(context, statement, incoming);
    case "while_statement":
      return appendLoop(context, statement, incoming);
    case "do_statement":
      return appendDoWhile(context, statement, incoming);
    case "switch_statement":
      return appendSwitch(context, statement, incoming);
    case "return_statement":
      return appendSimple(context, statement, incoming, "terminator", trimSemicolon(statement.text), "return");
    case "break_statement":
      return appendSimple(context, statement, incoming, "decision", "break", "break");
    case "continue_statement":
      return appendSimple(context, statement, incoming, "decision", "continue", "continue");
    case "compound_statement":
      return appendStatements(context, compoundStatements(statement), incoming, options);
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

function appendIf(
  context: BuildContext,
  statement: SyntaxNode,
  incoming: FlowExit[],
  options: AppendStatementsOptions = {}
): FlowExit[] {
  const decision = addNode(context, "decision", conditionExpressionText(statement), statement);
  connectIncoming(context, incoming, decision.id);

  const consequence = statement.childForFieldName("consequence");
  const alternative = statement.childForFieldName("alternative");
  const thenIncoming = [{ from: decision.id, kind: "normal" as const, label: "Yes" }];
  let thenExits = consequence ? appendStatement(context, consequence, thenIncoming, options) : thenIncoming;

  let elseExits: FlowExit[];
  if (alternative) {
    const elseBody = alternative.namedChildren[0];
    const elseIncoming = [
      { from: decision.id, kind: "normal" as const, label: "No", fromPort: "right" as const, toPort: "top" as const }
    ];
    elseExits = elseBody ? appendStatement(context, elseBody, elseIncoming, options) : elseIncoming;
  } else {
    elseExits = [{ from: decision.id, kind: "normal", label: "No", fromPort: "right", toPort: "top" }];
  }

  if (options.insideLoopBody) {
    const preferredRightBranch = loopRightBranch(thenExits, elseExits);
    if (preferredRightBranch === "then") {
      setDecisionBranchPort(context, decision.id, "Yes", "right");
      setDecisionBranchPort(context, decision.id, "No", "bottom");
      thenExits = setPendingBranchPort(thenExits, decision.id, "Yes", "right");
      elseExits = setPendingBranchPort(elseExits, decision.id, "No", "bottom");
    } else if (preferredRightBranch === "else") {
      setDecisionBranchPort(context, decision.id, "Yes", "bottom");
      setDecisionBranchPort(context, decision.id, "No", "right");
      thenExits = setPendingBranchPort(thenExits, decision.id, "Yes", "bottom");
      elseExits = setPendingBranchPort(elseExits, decision.id, "No", "right");
    }
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

  const bodyStartIndex = context.nodes.length;
  const bodyExits = appendStatement(context, body, [{ from: decision.id, kind: "normal", label: "Yes" }], { insideLoopBody: true });
  addLoopBodyGroup(context, decision.id, bodyStartIndex);

  const loopExits: FlowExit[] = [{ from: decision.id, kind: "normal", label: "No", fromPort: "right", toPort: "top" }];
  for (const exit of bodyExits) {
    if (exit.kind === "normal" || exit.kind === "continue") {
      connect(context, exit.from, decision.id, exit.kind === "continue" ? "Continue" : "Next", "right");
    } else if (exit.kind === "break") {
      loopExits.push({ from: exit.from, kind: "normal", label: "Break", fromPort: "right", toPort: "top" });
    } else {
      loopExits.push(exit);
    }
  }

  return loopExits;
}

function appendForLoop(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const initializer = statement.childForFieldName("initializer");
  const condition = statement.childForFieldName("condition");
  const update = statement.childForFieldName("update");
  const body = statement.childForFieldName("body");
  const initNode = addNode(context, "process", forPartText(initializer, "(none)"), initializer ?? statement, { suppressComment: true });
  connectIncoming(context, incoming, initNode.id);

  const conditionNode = addNode(context, "decision", `for\n${forPartText(condition, "true")}`, condition ?? statement, {
    commentSource: statement
  });
  connect(context, initNode.id, conditionNode.id);

  const bodyStartIndex = context.nodes.length;
  const bodyExits = body
    ? appendStatement(context, body, [{ from: conditionNode.id, kind: "normal", label: "Yes" }], { insideLoopBody: true })
    : [];
  addLoopBodyGroup(context, conditionNode.id, bodyStartIndex);

  const updateNode = addNode(context, "process", forPartText(update, "(none)"), update ?? statement, { suppressComment: true });
  const loopExits: FlowExit[] = [{ from: conditionNode.id, kind: "normal", label: "No", fromPort: "right", toPort: "top" }];

  if (!body || bodyExits.length === 0) {
    connect(context, conditionNode.id, updateNode.id, "Yes");
  }

  for (const exit of bodyExits) {
    if (exit.kind === "normal" || exit.kind === "continue") {
      connect(
        context,
        exit.from,
        updateNode.id,
        exit.kind === "continue" ? "Continue" : exit.label,
        exit.kind === "continue" ? "right" : exit.fromPort ?? "bottom",
        exit.toPort
      );
    } else if (exit.kind === "break") {
      loopExits.push({ from: exit.from, kind: "normal", label: "Break", fromPort: "right", toPort: "top" });
    } else {
      loopExits.push(exit);
    }
  }

  connect(context, updateNode.id, conditionNode.id, "Next", "right");
  return loopExits;
}

function appendDoWhile(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const body = statement.childForFieldName("body");
  if (!body) {
    const decision = addNode(context, "decision", loopLabel(statement), statement);
    connectIncoming(context, incoming, decision.id);
    return [{ from: decision.id, kind: "normal", label: "No", fromPort: "right", toPort: "top" }];
  }

  const firstBodyIndex = context.nodes.length;
  const bodyExits = appendStatement(context, body, incoming, { insideLoopBody: true });
  addLoopBodyGroup(context, "", firstBodyIndex);
  const firstBodyNode = context.nodes[firstBodyIndex];
  const decision = addNode(context, "decision", loopLabel(statement), statement);
  updateLatestLoopBodyOwner(context, decision.id);
  const loopExits: FlowExit[] = [{ from: decision.id, kind: "normal", label: "No", fromPort: "right", toPort: "top" }];

  for (const exit of bodyExits) {
    if (exit.kind === "normal" || exit.kind === "continue") {
      connect(context, exit.from, decision.id, exit.kind === "continue" ? "Continue" : "Next", "right");
    } else if (exit.kind === "break") {
      loopExits.push({ from: exit.from, kind: "normal", label: "Break", fromPort: "right", toPort: "top" });
    } else {
      loopExits.push(exit);
    }
  }

  if (firstBodyNode) {
    connect(context, decision.id, firstBodyNode.id, "Yes", "right");
  }

  return loopExits;
}

function appendSwitch(context: BuildContext, statement: SyntaxNode, incoming: FlowExit[]): FlowExit[] {
  const decision = addNode(context, "decision", `switch\n${conditionExpressionText(statement)}`, statement);
  connectIncoming(context, incoming, decision.id);

  const body = statement.childForFieldName("body");
  const cases = body?.namedChildren.filter((child) => child.type === "case_statement") ?? [];
  if (cases.length === 0) {
    return [{ from: decision.id, kind: "normal" }];
  }

  const caseEntries: { labels: string[]; bodyStatements: SyntaxNode[] }[] = [];
  let pendingCaseLabels: string[] = [];
  for (const caseNode of cases) {
    pendingCaseLabels.push(caseLabel(caseNode));
    const bodyStatements = caseBodyStatements(caseNode);
    if (bodyStatements.length === 0) {
      continue;
    }
    caseEntries.push({ labels: pendingCaseLabels, bodyStatements });
    pendingCaseLabels = [];
  }
  if (caseEntries.length === 0) {
    return [{ from: decision.id, kind: "normal" }];
  }

  const exits: FlowExit[] = [];
  let fallthrough: FlowExit[] = [];

  for (const [index, entry] of caseEntries.entries()) {
    const firstCaseNodeIndex = context.nodes.length;
    const caseExits = appendStatements(context, entry.bodyStatements, [], { allowDisconnectedFirstStatement: true });
    const firstCaseNode = context.nodes[firstCaseNodeIndex];
    if (!firstCaseNode) {
      continue;
    }
    entry.labels.forEach((label) => {
      connect(context, decision.id, firstCaseNode.id, label, "bottom");
    });
    connectIncoming(context, fallthrough, firstCaseNode.id);
    fallthrough = [];

    for (const exit of caseExits) {
      if (exit.kind === "break") {
        exits.push({ from: exit.from, kind: "normal", label: "Break", fromPort: "right", toPort: "top" });
      } else if (exit.kind === "normal" && index < caseEntries.length - 1) {
        fallthrough.push({ from: exit.from, kind: "normal", label: "Fallthrough", fromPort: "right", toPort: "top" });
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

function loopRightBranch(thenExits: FlowExit[], elseExits: FlowExit[]): "then" | "else" | undefined {
  const thenPriority = loopBranchPriority(thenExits);
  const elsePriority = loopBranchPriority(elseExits);
  if (thenPriority > elsePriority) {
    return "then";
  }
  if (elsePriority > thenPriority) {
    return "else";
  }
  return undefined;
}

function loopBranchPriority(exits: FlowExit[]): number {
  if (exits.some((exit) => exit.kind === "break")) {
    return 4;
  }
  if (exits.some((exit) => exit.kind === "return")) {
    return 3;
  }
  if (exits.some((exit) => exit.kind === "continue")) {
    return 2;
  }
  if (exits.some((exit) => exit.kind === "normal")) {
    return 1;
  }
  return 0;
}

function setDecisionBranchPort(context: BuildContext, decisionId: string, label: string, fromPort: FlowFromPort): void {
  for (const [index, edge] of context.edges.entries()) {
    if (edge.from === decisionId && edge.label === label) {
      context.edges[index] = { ...edge, fromPort };
    }
  }
}

function setPendingBranchPort(exits: FlowExit[], decisionId: string, label: string, fromPort: FlowFromPort): FlowExit[] {
  return exits.map((exit) => {
    if (exit.from === decisionId && exit.label === label) {
      return { ...exit, fromPort };
    }
    return exit;
  });
}

function addNode(
  context: BuildContext,
  kind: FlowNodeKind,
  label: string,
  source?: SyntaxNode,
  options: AddNodeOptions = {}
): FlowNode {
  const commentSource = options.suppressComment ? undefined : options.commentSource ?? source;
  const comment = commentSource ? commentForSource(context, commentSource) : undefined;
  const node: FlowNode = {
    id: `n${context.nextId++}`,
    kind,
    label,
    ...(comment ? { comment } : {}),
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

function addLoopBodyGroup(context: BuildContext, ownerNodeId: string, bodyStartIndex: number): void {
  const nodeIds = context.nodes.slice(bodyStartIndex).map((node) => node.id);
  if (nodeIds.length === 0) {
    return;
  }
  context.groups.push({
    id: `g${context.nextGroupId++}`,
    kind: "loopBody",
    label: "Loop body",
    ownerNodeId,
    nodeIds
  });
}

function updateLatestLoopBodyOwner(context: BuildContext, ownerNodeId: string): void {
  const latest = context.groups.at(-1);
  if (!latest || latest.ownerNodeId) {
    return;
  }
  context.groups[context.groups.length - 1] = {
    ...latest,
    ownerNodeId
  };
}

function connectIncoming(context: BuildContext, incoming: FlowExit[], to: string): void {
  for (const exit of incoming) {
    connect(context, exit.from, to, exit.label, exit.fromPort, exit.toPort);
  }
}

function connect(
  context: BuildContext,
  from: string,
  to: string,
  label?: string,
  fromPort: FlowFromPort = "bottom",
  toPort: FlowToPort = "top"
): void {
  context.edges.push({ from, to, fromPort, toPort, ...(label ? { label } : {}) });
}

function compoundStatements(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child) => isStatementLike(child));
}

function caseBodyStatements(caseNode: SyntaxNode): SyntaxNode[] {
  return caseNode.namedChildren.filter((child) => isStatementLike(child));
}

function isStatementLike(node: SyntaxNode): boolean {
  return node.type.endsWith("_statement") || node.type === "declaration";
}

function collectComments(rootNode: SyntaxNode): SourceComment[] {
  const comments: SourceComment[] = [];
  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.type === "comment") {
      comments.push({
        text: cleanCommentText(node.text),
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column
      });
    }
    stack.push(...node.children);
  }
  return comments.sort((a, b) => a.startIndex - b.startIndex);
}

function commentForSource(context: BuildContext, source: SyntaxNode): string | undefined {
  const leading = leadingCommentsForSource(context, source);
  const inline = context.comments.filter(
    (comment) => comment.startLine === source.endPosition.row + 1 && comment.startIndex >= source.endIndex
  );
  const headerInline = context.comments.filter(
    (comment) =>
      comment.startLine === source.startPosition.row + 1 &&
      comment.startIndex > source.startIndex &&
      comment.startIndex < source.endIndex
  );
  const comments = [...leading, ...inline, ...headerInline].map((comment) => comment.text).filter((text) => text.length > 0);
  return comments.length > 0 ? comments.join("\n") : undefined;
}

function leadingCommentsForSource(context: BuildContext, source: SyntaxNode): SourceComment[] {
  const result: SourceComment[] = [];
  let line = source.startPosition.row;
  while (line >= 1) {
    const comments = context.comments.filter((comment) => comment.endLine === line && isStandaloneCommentLine(context, comment));
    if (comments.length === 0) {
      break;
    }
    result.unshift(...comments);
    line = Math.min(...comments.map((comment) => comment.startLine)) - 1;
  }
  return result;
}

function isStandaloneCommentLine(context: BuildContext, comment: SourceComment): boolean {
  const line = context.sourceLines[comment.startLine - 1] ?? "";
  return line.slice(0, comment.startColumn).trim().length === 0;
}

function cleanCommentText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("//")) {
    return trimmed.slice(2).trim();
  }
  if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) {
    return trimmed
      .slice(2, -2)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*/, "").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return trimmed;
}

function conditionText(statement: SyntaxNode): string {
  const condition = statement.childForFieldName("condition");
  return condition ? normalizeWhitespace(condition.text) : "(condition)";
}

function conditionExpressionText(statement: SyntaxNode): string {
  return stripEnclosingParentheses(conditionText(statement));
}

function stripEnclosingParentheses(text: string): string {
  let result = normalizeWhitespace(text);
  while (isWrappedBySingleParenthesisPair(result)) {
    result = normalizeWhitespace(result.slice(1, -1));
  }
  return result;
}

function isWrappedBySingleParenthesisPair(text: string): boolean {
  if (!text.startsWith("(") || !text.endsWith(")")) {
    return false;
  }

  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth < 0 || (depth === 0 && index < text.length - 1)) {
        return false;
      }
    }
  }
  return depth === 0;
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

function forPartText(node: SyntaxNode | null, fallback: string): string {
  return node ? normalizeStatement(node.text) : fallback;
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
