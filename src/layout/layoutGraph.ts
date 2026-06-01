import type { FlowModel, FlowNodeKind } from "../flow/flowModel";

export interface FlowPosition {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutFlow extends FlowModel {
  readonly positions: Record<string, FlowPosition>;
  readonly page: {
    readonly width: number;
    readonly height: number;
  };
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

  const width = Math.max(8.5, maxX - minX + LEFT_MARGIN * 2);
  const height = Math.max(11, flow.nodes.length * VERTICAL_SPACING + TOP_MARGIN * 2);
  const xOffset = minX < 0 ? Math.abs(minX) + LEFT_MARGIN : 0;
  if (xOffset > 0) {
    for (const position of Object.values(positions)) {
      (position as { x: number }).x += xOffset;
    }
  }

  return {
    ...flow,
    positions,
    page: { width, height }
  };
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
