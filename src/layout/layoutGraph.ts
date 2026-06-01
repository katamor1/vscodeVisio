import type { FlowEdge, FlowGroup, FlowModel, FlowNode, FlowNodeKind } from "../flow/flowModel";

export interface FlowPosition {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutFlow extends FlowModel {
  readonly positions: Record<string, FlowPosition>;
  readonly commentPositions: Record<string, FlowPosition>;
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

const KIND_WIDTH: Record<FlowNodeKind, number> = {
  start: 2.2,
  process: 2.8,
  decision: 2.6,
  terminator: 2.2
};

const VERTICAL_SPACING = 0.95;
const HORIZONTAL_SPACING = 3.35;
const TOP_MARGIN = 1.2;
const LEFT_MARGIN = 1.2;
const GROUP_PADDING_X = 0.45;
const GROUP_PADDING_Y = 0.38;
const COMMENT_OFFSET_X = 3.05;

export function layoutFlow(flow: FlowModel): LaidOutFlow {
  const depthByNode = computeDecisionDepth(flow);
  const positions: Record<string, FlowPosition> = {};
  let minX = 0;
  let maxX = 0;

  flow.nodes.forEach((node, index) => {
    const depth = depthByNode[node.id] ?? 0;
    const x = LEFT_MARGIN + depth * HORIZONTAL_SPACING;
    const y = TOP_MARGIN + (flow.nodes.length - index - 1) * VERTICAL_SPACING;
    positions[node.id] = { x, y };
    minX = Math.min(minX, x - KIND_WIDTH[node.kind] / 2);
    maxX = Math.max(maxX, x + KIND_WIDTH[node.kind] / 2);
  });

  const commentPositions = computeCommentPositions(flow.nodes, positions);
  for (const position of Object.values(commentPositions)) {
    maxX = Math.max(maxX, position.x + 1.5);
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

  const groupBoxes = computeGroupBoxes(flow.groups, flow.nodes, positions);
  for (const box of groupBoxes) {
    minX = Math.min(minX, box.left);
    maxX = Math.max(maxX, box.right);
  }

  const routedEdges = routeUpwardEdgesFromBottom(flow.edges, positions);
  const width = Math.max(8.5, maxX - minX + LEFT_MARGIN * 2);
  const height = Math.max(
    11,
    flow.nodes.length * VERTICAL_SPACING + TOP_MARGIN * 2,
    ...groupBoxes.map((box) => box.top + TOP_MARGIN)
  );

  return {
    ...flow,
    edges: routedEdges,
    positions,
    commentPositions,
    groupBoxes,
    page: { width, height }
  };
}

function routeUpwardEdgesFromBottom(edges: readonly FlowEdge[], positions: Record<string, FlowPosition>): FlowEdge[] {
  return edges.map((edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to || to.y <= from.y || edge.fromPort === "bottom") {
      return edge;
    }
    return { ...edge, fromPort: "bottom" };
  });
}

function computeCommentPositions(nodes: FlowNode[], positions: Record<string, FlowPosition>): Record<string, FlowPosition> {
  const commentPositions: Record<string, FlowPosition> = {};
  for (const node of nodes) {
    if (!node.comment) {
      continue;
    }
    const position = positions[node.id];
    if (!position) {
      continue;
    }
    commentPositions[node.id] = {
      x: position.x + COMMENT_OFFSET_X,
      y: position.y
    };
  }
  return commentPositions;
}

function computeGroupBoxes(groups: FlowGroup[], nodes: FlowNode[], positions: Record<string, FlowPosition>): FlowGroupBox[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const boxes: FlowGroupBox[] = [];

  for (const group of groups) {
    const members = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is FlowNode => node !== undefined && positions[node.id] !== undefined);
    if (members.length === 0) {
      continue;
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

    boxes.push({ ...group, left, right, top, bottom });
  }

  return boxes;
}

function nodeHeight(node: FlowNode): number {
  const lineCount = node.label.split("\n").length;
  return Math.max(0.55, 0.34 * lineCount + 0.25);
}

function computeDecisionDepth(flow: FlowModel): Record<string, number> {
  const depths: Record<string, number> = {};
  const outgoing = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  for (const node of flow.nodes) {
    if (depths[node.id] === undefined) {
      depths[node.id] = 0;
    }
    const children = outgoing.get(node.id) ?? [];
    children.forEach((childId, childIndex) => {
      const offset = node.kind === "decision" && childIndex > 0 ? childIndex : 0;
      depths[childId] = Math.max(depths[childId] ?? 0, depths[node.id] + offset);
    });
  }

  return depths;
}
