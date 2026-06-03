import type { FlowEdge, FlowGroup, FlowLabelPosition, FlowModel, FlowNode, FlowNodeKind } from "../flow/flowModel";

export interface FlowPosition {
  readonly x: number;
  readonly y: number;
}

export interface FlowCommentPosition extends FlowPosition {
  readonly width: number;
  readonly height: number;
}

export interface LaidOutFlow extends FlowModel {
  readonly positions: Record<string, FlowPosition>;
  readonly commentPositions: Record<string, FlowCommentPosition>;
  readonly groupBoxes: FlowGroupBox[];
  readonly page: {
    readonly width: number;
    readonly height: number;
  };
}

export interface FlowGroupBox extends FlowGroup {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface FlowBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const KIND_WIDTH: Record<FlowNodeKind, number> = {
  start: 2.2,
  process: 2.8,
  decision: 2.6,
  terminator: 2.2
};

const VERTICAL_SPACING = 0.95;
const DECISION_VERTICAL_EXTRA_SPACING = 0.36;
const HORIZONTAL_SPACING = 3.35;
const TOP_MARGIN = 1.2;
const LEFT_MARGIN = 1.2;
const GROUP_PADDING_X = 0.45;
const GROUP_PADDING_Y = 0.38;
const GROUP_EXIT_SPACING = 0.55;
const GROUP_OWNER_CENTER_GAP = 0.15;
const COMMENT_OFFSET_X = 3.05;
const COMMENT_MIN_WIDTH = 0.8;
const COMMENT_MIN_HEIGHT = 0.34;
const COMMENT_HORIZONTAL_PADDING = 0.32;
const COMMENT_VERTICAL_PADDING = 0.18;
const COMMENT_ASCII_CHAR_WIDTH = 0.055;
const COMMENT_WIDE_CHAR_WIDTH = 0.095;
const COMMENT_LINE_HEIGHT = 0.17;
const DECISION_COMMENT_MARGIN_Y = 0.14;
const EDGE_LABEL_MIN_WIDTH = 0.45;
const EDGE_LABEL_HEIGHT = 0.22;
const EDGE_LABEL_HORIZONTAL_PADDING = 0.14;
const DECISION_EDGE_LABEL_MARGIN = 0.08;
const SWITCH_EDGE_LABEL_RIGHT_MARGIN = 0.08;
const SWITCH_EDGE_LABEL_TARGET_TOP_GAP = 0.1;
const LOOP_BACK_LANE_GAP = 0.65;
const LOOP_CONDITION_EXIT_LANE_GAP = 0.65;
const LOOP_CONDITION_EXIT_TARGET_GAP = 0.35;
const LOOP_CONDITION_ENTRY_SPACING = 0.7;
const LOOP_CONDITION_BODY_CLEARANCE = 0.12;

export function layoutFlow(flow: FlowModel): LaidOutFlow {
  const depthByNode = computeDecisionDepth(flow);
  const groupGapByIndex = computeGroupGapByIndex(flow.groups, flow.nodes);
  const extraYOffsetByIndex = computeExtraYOffsetByIndex(flow.nodes.length, groupGapByIndex);
  const positions: Record<string, FlowPosition> = {};

  flow.nodes.forEach((node, index) => {
    const depth = depthByNode[node.id] ?? 0;
    const x = LEFT_MARGIN + depth * HORIZONTAL_SPACING;
    const y = TOP_MARGIN + (flow.nodes.length - index - 1) * VERTICAL_SPACING + extraYOffsetByIndex[index];
    positions[node.id] = { x, y };
  });

  applyLoopGroupOffsets(flow.groups, flow.nodes, positions);
  let groupBoxes = computeGroupBoxes(flow.groups, flow.nodes, positions);
  for (let pass = 0; pass <= flow.groups.length; pass++) {
    const changed = separateLoopConditionBodies(flow.edges, flow.nodes, positions, groupBoxes);
    groupBoxes = computeGroupBoxes(flow.groups, flow.nodes, positions);
    if (!changed) {
      break;
    }
  }
  for (let pass = 0; pass <= flow.groups.length; pass++) {
    const changed = alignLoopConditionExitTargets(flow.edges, flow.nodes, positions, groupBoxes);
    groupBoxes = computeGroupBoxes(flow.groups, flow.nodes, positions);
    if (!changed) {
      break;
    }
  }

  const commentPositions = computeCommentPositions(flow.nodes, positions);
  let { minX, maxX } = computeNodeHorizontalBounds(flow.nodes, positions);
  for (const position of Object.values(commentPositions)) {
    maxX = Math.max(maxX, position.x + position.width / 2);
  }

  const xOffset = minX < 0 ? Math.abs(minX) + LEFT_MARGIN : 0;
  if (xOffset > 0) {
    for (const position of Object.values(positions)) {
      (position as { x: number }).x += xOffset;
    }
    for (const position of Object.values(commentPositions)) {
      (position as { x: number }).x += xOffset;
    }
    minX += xOffset;
    maxX += xOffset;
  }

  groupBoxes = computeGroupBoxes(flow.groups, flow.nodes, positions);
  for (const box of groupBoxes) {
    minX = Math.min(minX, box.left);
    maxX = Math.max(maxX, box.right);
  }

  const routedEdges = routeUpwardEdgesAroundGroups(flow.edges, flow.nodes, positions, groupBoxes);
  const labelledEdges = addEdgeLabelPositions(routedEdges, flow.nodes, positions);
  for (const edge of labelledEdges) {
    if (edge.routeNode) {
      minX = Math.min(minX, edge.routeNode.x);
      maxX = Math.max(maxX, edge.routeNode.x);
    }
    if (edge.labelPosition) {
      minX = Math.min(minX, edge.labelPosition.x - edge.labelPosition.width / 2);
      maxX = Math.max(maxX, edge.labelPosition.x + edge.labelPosition.width / 2);
    }
  }
  const maxNodeY = Math.max(TOP_MARGIN, ...Object.values(positions).map((position) => position.y));
  const maxCommentY = Math.max(
    TOP_MARGIN,
    ...Object.values(commentPositions).map((position) => position.y + position.height / 2)
  );
  const maxEdgeLabelY = Math.max(
    TOP_MARGIN,
    ...labelledEdges.map((edge) =>
      edge.labelPosition ? edge.labelPosition.y + edge.labelPosition.height / 2 : TOP_MARGIN
    )
  );
  const width = Math.max(8.5, maxX - minX + LEFT_MARGIN * 2);
  const height = Math.max(
    11,
    maxNodeY + TOP_MARGIN,
    maxCommentY + TOP_MARGIN,
    maxEdgeLabelY + TOP_MARGIN,
    ...groupBoxes.map((box) => box.top + TOP_MARGIN)
  );

  return {
    ...flow,
    edges: labelledEdges,
    positions,
    commentPositions,
    groupBoxes,
    page: { width, height }
  };
}

function routeUpwardEdgesAroundGroups(
  edges: readonly FlowEdge[],
  nodes: FlowNode[],
  positions: Record<string, FlowPosition>,
  groupBoxes: FlowGroupBox[]
): FlowEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) {
      return edge;
    }

    const conditionExitBox = loopConditionExitBox(edge, from, to, groupBoxes, positions);
    if (conditionExitBox) {
      return {
        ...edge,
        routeNode: {
          id: `route-${edge.from}-${edge.to}`,
          x: conditionExitBox.right + LOOP_CONDITION_EXIT_LANE_GAP,
          y: (conditionExitBox.top + conditionExitBox.bottom) / 2,
          orientation: "vertical",
          inPort: "top",
          outPort: "bottom"
        }
      };
    }

    if (to.y <= from.y) {
      return edge;
    }

    const routedEdge: FlowEdge = { ...edge, fromPort: "bottom" };
    const ownLoopBox = groupBoxes.find((box) => box.ownerNodeId === edge.to || box.ownerNodeId === edge.from);
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!ownLoopBox || !fromNode || !toNode) {
      return routedEdge;
    }

    const end = portPosition(toNode, to, "top");
    const laneX = Math.min(portPosition(fromNode, from, "bottom").x, end.x, ownLoopBox.left) - LOOP_BACK_LANE_GAP;
    return {
      ...routedEdge,
      routeNode: {
        id: `route-${edge.from}-${edge.to}`,
        x: laneX,
        y: end.y,
        orientation: "vertical",
        inPort: "bottom",
        outPort: "top"
      }
    };
  });
}

function addEdgeLabelPositions(
  edges: readonly FlowEdge[],
  nodes: FlowNode[],
  positions: Record<string, FlowPosition>
): FlowEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const labelIndexByBranch = new Map<string, number>();

  return edges.map((edge) => {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!edge.label || !fromNode || !toNode || !from || !to) {
      return edge;
    }

    if (!isSwitchDecision(fromNode) && fromNode.kind === "decision" && isYesNoLabel(edge.label)) {
      return {
        ...edge,
        labelPosition: computeDecisionBranchLabelPosition(edge.label, fromNode, from, edge.fromPort)
      };
    }

    if (!isSwitchDecision(fromNode)) {
      return edge;
    }

    const branchKey = `${edge.from}->${edge.to}`;
    const labelIndex = labelIndexByBranch.get(branchKey) ?? 0;
    labelIndexByBranch.set(branchKey, labelIndex + 1);

    return {
      ...edge,
      labelPosition: computeSwitchEdgeLabelPosition(edge.label, fromNode, from, toNode, to, labelIndex)
    };
  });
}

function isYesNoLabel(label: string): boolean {
  return label === "Yes" || label === "No";
}

function isSwitchDecision(node: FlowNode): boolean {
  return node.kind === "decision" && node.label.startsWith("switch\n");
}

function computeDecisionBranchLabelPosition(
  label: string,
  fromNode: FlowNode,
  from: FlowPosition,
  fromPort: FlowEdge["fromPort"]
): FlowLabelPosition {
  const width = computeEdgeLabelWidth(label);
  const height = EDGE_LABEL_HEIGHT;
  switch (fromPort) {
    case "right":
      return {
        x: from.x + KIND_WIDTH[fromNode.kind] / 2 + DECISION_EDGE_LABEL_MARGIN + width / 2,
        y: from.y - height / 2 - DECISION_EDGE_LABEL_MARGIN,
        width,
        height
      };
    case "left":
      return {
        x: from.x - KIND_WIDTH[fromNode.kind] / 2 - DECISION_EDGE_LABEL_MARGIN - width / 2,
        y: from.y - height / 2 - DECISION_EDGE_LABEL_MARGIN,
        width,
        height
      };
    case "bottom":
      return {
        x: from.x + DECISION_EDGE_LABEL_MARGIN + width / 2,
        y: from.y - nodeHeight(fromNode) / 2 - DECISION_EDGE_LABEL_MARGIN - height / 2,
        width,
        height
      };
  }
}

function computeSwitchEdgeLabelPosition(
  label: string,
  fromNode: FlowNode,
  from: FlowPosition,
  toNode: FlowNode,
  to: FlowPosition,
  labelIndex: number
): FlowLabelPosition {
  const width = computeEdgeLabelWidth(label);
  const labelStackGap = labelIndex * (EDGE_LABEL_HEIGHT + 0.04);
  return {
    x: from.x + KIND_WIDTH[fromNode.kind] / 2 + SWITCH_EDGE_LABEL_RIGHT_MARGIN + width / 2,
    y: to.y + nodeHeight(toNode) / 2 + SWITCH_EDGE_LABEL_TARGET_TOP_GAP + labelStackGap,
    width,
    height: EDGE_LABEL_HEIGHT
  };
}

function computeEdgeLabelWidth(label: string): number {
  return Math.max(EDGE_LABEL_MIN_WIDTH, commentLineWidth(label) + EDGE_LABEL_HORIZONTAL_PADDING);
}

function alignLoopConditionExitTargets(
  edges: readonly FlowEdge[],
  nodes: FlowNode[],
  positions: Record<string, FlowPosition>,
  groupBoxes: FlowGroupBox[]
): boolean {
  let changed = false;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) {
      continue;
    }

    const conditionExitBox = loopConditionExitBox(edge, from, to, groupBoxes, positions);
    if (!conditionExitBox) {
      continue;
    }

    const routeX = conditionExitBox.right + LOOP_CONDITION_EXIT_LANE_GAP;
    const toNode = nodeById.get(edge.to);
    const targetX = routeX + (toNode ? KIND_WIDTH[toNode.kind] / 2 : 0) + LOOP_CONDITION_EXIT_TARGET_GAP;
    if (to.x < targetX) {
      (to as { x: number }).x = targetX;
      changed = true;
    }
  }
  return changed;
}

function separateLoopConditionBodies(
  edges: readonly FlowEdge[],
  nodes: FlowNode[],
  positions: Record<string, FlowPosition>,
  groupBoxes: FlowGroupBox[]
): boolean {
  let changed = false;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const box of groupBoxes) {
    const owner = nodeById.get(box.ownerNodeId);
    const ownerPosition = positions[box.ownerNodeId];
    if (!owner || !ownerPosition || ownerPosition.y <= box.top) {
      continue;
    }

    const ownerBottom = ownerPosition.y - nodeHeight(owner) / 2;
    const requiredBoxTop = ownerBottom - LOOP_CONDITION_BODY_CLEARANCE;
    if (box.top <= requiredBoxTop) {
      continue;
    }

    const delta = box.top - requiredBoxTop;
    const shiftedIds = new Set(box.nodeIds);
    for (const edge of edges) {
      if (edge.to === box.ownerNodeId && !shiftedIds.has(edge.from) && edge.from !== box.ownerNodeId) {
        shiftedIds.add(edge.from);
      }
    }

    for (const nodeId of shiftedIds) {
      const position = positions[nodeId];
      if (position) {
        (position as { y: number }).y -= delta;
        changed = true;
      }
    }
  }

  return changed;
}

function loopConditionExitBox(
  edge: FlowEdge,
  from: FlowPosition,
  to: FlowPosition,
  groupBoxes: FlowGroupBox[],
  positions: Record<string, FlowPosition>
): FlowGroupBox | undefined {
  return groupBoxes.find((box) => {
    if (box.ownerNodeId !== edge.from || box.nodeIds.includes(edge.to) || edge.fromPort !== "right") {
      return false;
    }
    const owner = positions[box.ownerNodeId];
    return owner !== undefined && owner.y > box.top && to.y < from.y;
  });
}

function portPosition(node: FlowNode, position: FlowPosition, port: "left" | "right" | "bottom" | "top"): FlowPosition {
  const width = KIND_WIDTH[node.kind];
  const height = nodeHeight(node);
  switch (port) {
    case "left":
      return { x: position.x - width / 2, y: position.y };
    case "right":
      return { x: position.x + width / 2, y: position.y };
    case "bottom":
      return { x: position.x, y: position.y - height / 2 };
    case "top":
      return { x: position.x, y: position.y + height / 2 };
  }
}

function computeCommentPositions(nodes: FlowNode[], positions: Record<string, FlowPosition>): Record<string, FlowCommentPosition> {
  const commentPositions: Record<string, FlowCommentPosition> = {};
  for (const node of nodes) {
    if (!node.comment) {
      continue;
    }
    const position = positions[node.id];
    if (!position) {
      continue;
    }
    const commentSize = computeCommentSize(node.comment);
    commentPositions[node.id] = {
      x: position.x + COMMENT_OFFSET_X,
      y: position.y + (node.kind === "decision" ? commentSize.height / 2 + DECISION_COMMENT_MARGIN_Y : 0),
      width: commentSize.width,
      height: commentSize.height
    };
  }
  return commentPositions;
}

function computeCommentSize(comment: string): { width: number; height: number } {
  const lines = comment.split(/\r?\n/);
  const widestLine = Math.max(0, ...lines.map((line) => commentLineWidth(line)));
  return {
    width: Math.max(COMMENT_MIN_WIDTH, widestLine + COMMENT_HORIZONTAL_PADDING),
    height: Math.max(COMMENT_MIN_HEIGHT, lines.length * COMMENT_LINE_HEIGHT + COMMENT_VERTICAL_PADDING)
  };
}

function commentLineWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    width += char.charCodeAt(0) <= 0x7f ? COMMENT_ASCII_CHAR_WIDTH : COMMENT_WIDE_CHAR_WIDTH;
  }
  return width;
}

function computeGroupGapByIndex(groups: FlowGroup[], nodes: FlowNode[]): Map<number, number> {
  const gapByIndex = computeGroupExitGapByIndex(groups, nodes);
  addLoopConditionEntryGaps(gapByIndex, groups, nodes);
  addDecisionVerticalGaps(gapByIndex, nodes);
  return gapByIndex;
}

function addDecisionVerticalGaps(gapByIndex: Map<number, number>, nodes: FlowNode[]): void {
  for (let upperIndex = 0; upperIndex < nodes.length - 1; upperIndex++) {
    const upper = nodes[upperIndex];
    const lower = nodes[upperIndex + 1];
    if (upper.kind !== "decision" && lower.kind !== "decision") {
      continue;
    }
    gapByIndex.set(upperIndex, (gapByIndex.get(upperIndex) ?? 0) + DECISION_VERTICAL_EXTRA_SPACING);
  }
}

function computeGroupExitGapByIndex(groups: FlowGroup[], nodes: FlowNode[]): Map<number, number> {
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  const gapByIndex = new Map<number, number>();

  for (const group of groups) {
    const memberIndices = group.nodeIds
      .map((nodeId) => nodeIndexById.get(nodeId))
      .filter((index): index is number => index !== undefined);
    if (memberIndices.length === 0) {
      continue;
    }

    const lastMemberIndex = Math.max(...memberIndices);
    if (lastMemberIndex >= nodes.length - 1) {
      continue;
    }

    setMaxGap(gapByIndex, lastMemberIndex, GROUP_EXIT_SPACING);
  }

  return gapByIndex;
}

function addLoopConditionEntryGaps(gapByIndex: Map<number, number>, groups: FlowGroup[], nodes: FlowNode[]): void {
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));

  for (const group of groups) {
    const ownerIndex = nodeIndexById.get(group.ownerNodeId);
    const memberIndices = group.nodeIds
      .map((nodeId) => nodeIndexById.get(nodeId))
      .filter((index): index is number => index !== undefined);
    if (ownerIndex === undefined || ownerIndex === 0 || memberIndices.length === 0) {
      continue;
    }

    if (ownerIndex < Math.min(...memberIndices)) {
      setMaxGap(gapByIndex, ownerIndex - 1, LOOP_CONDITION_ENTRY_SPACING);
    }
  }
}

function setMaxGap(gapByIndex: Map<number, number>, index: number, gap: number): void {
  gapByIndex.set(index, Math.max(gapByIndex.get(index) ?? 0, gap));
}

function computeExtraYOffsetByIndex(nodeCount: number, gapByIndex: Map<number, number>): number[] {
  const offsets = Array<number>(nodeCount).fill(0);
  for (const [lastMemberIndex, gap] of gapByIndex) {
    for (let index = 0; index <= lastMemberIndex; index++) {
      offsets[index] += gap;
    }
  }
  return offsets;
}

function applyLoopGroupOffsets(groups: FlowGroup[], nodes: FlowNode[], positions: Record<string, FlowPosition>): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const group of groups) {
    const bounds = computeGroupMemberBounds(group, nodeById, positions);
    const ownerPosition = positions[group.ownerNodeId];
    if (!bounds || !ownerPosition) {
      continue;
    }

    const requiredCenter = ownerPosition.x + GROUP_OWNER_CENTER_GAP;
    const center = (bounds.left + bounds.right) / 2;
    if (center > requiredCenter) {
      continue;
    }

    const delta = requiredCenter - center;
    for (const nodeId of group.nodeIds) {
      const position = positions[nodeId];
      if (position) {
        (position as { x: number }).x += delta;
      }
    }
  }
}

function computeGroupBoxes(groups: FlowGroup[], nodes: FlowNode[], positions: Record<string, FlowPosition>): FlowGroupBox[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const boxes: FlowGroupBox[] = [];

  for (const group of groups) {
    const bounds = computeGroupMemberBounds(group, nodeById, positions);
    if (!bounds) {
      continue;
    }

    boxes.push({ ...group, ...bounds });
  }

  return boxes;
}

function computeGroupMemberBounds(
  group: FlowGroup,
  nodeById: Map<string, FlowNode>,
  positions: Record<string, FlowPosition>
): FlowBounds | undefined {
  const members = group.nodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is FlowNode => node !== undefined && positions[node.id] !== undefined);
  if (members.length === 0) {
    return undefined;
  }

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (const node of members) {
    const position = positions[node.id];
    const width = KIND_WIDTH[node.kind];
    const height = nodeHeight(node);
    left = Math.min(left, position.x - width / 2 - GROUP_PADDING_X);
    right = Math.max(right, position.x + width / 2 + GROUP_PADDING_X);
    top = Math.max(top, position.y + height / 2 + GROUP_PADDING_Y);
    bottom = Math.min(bottom, position.y - height / 2 - GROUP_PADDING_Y);
  }

  return { left, right, top, bottom };
}

function computeNodeHorizontalBounds(nodes: FlowNode[], positions: Record<string, FlowPosition>): { minX: number; maxX: number } {
  let minX = 0;
  let maxX = 0;
  for (const node of nodes) {
    const position = positions[node.id];
    if (!position) {
      continue;
    }
    minX = Math.min(minX, position.x - KIND_WIDTH[node.kind] / 2);
    maxX = Math.max(maxX, position.x + KIND_WIDTH[node.kind] / 2);
  }
  return { minX, maxX };
}

function nodeHeight(node: FlowNode): number {
  const lineCount = node.label.split("\n").length;
  return Math.max(0.55, 0.34 * lineCount + 0.25);
}

function computeDecisionDepth(flow: FlowModel): Record<string, number> {
  const depths: Record<string, number> = {};
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  for (const node of flow.nodes) {
    if (depths[node.id] === undefined) {
      depths[node.id] = 0;
    }
    const children = outgoing.get(node.id) ?? [];
    children.forEach((edge) => {
      const offset = decisionDepthOffset(node, edge, children);
      depths[edge.to] = Math.max(depths[edge.to] ?? 0, depths[node.id] + offset);
    });
  }

  return depths;
}

function decisionDepthOffset(node: FlowNode, edge: FlowEdge, siblings: readonly FlowEdge[]): number {
  if (isSwitchDecision(node)) {
    return switchBranchDepthOffset(edge, siblings);
  }
  return node.kind === "decision" && edge.fromPort === "right" ? 1 : 0;
}

function switchBranchDepthOffset(edge: FlowEdge, siblings: readonly FlowEdge[]): number {
  if (!edge.label) {
    return 0;
  }
  const branchEdges = siblings.filter((sibling) => sibling.label);
  const defaultTarget = branchEdges.find((sibling) => sibling.label === "default")?.to;
  const bottomTarget = defaultTarget ?? branchEdges[branchEdges.length - 1]?.to;
  return bottomTarget && edge.to !== bottomTarget ? 1 : 0;
}
