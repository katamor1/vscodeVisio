import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCSelection } from "../src/parser/cSelectionParser";
import { buildFlowModel, countFlowSteps } from "../src/flow/flowModel";
import { layoutFlow } from "../src/layout/layoutGraph";

test("builds a flow model for a whole selected C function", async () => {
  const source = `int sample(int x) {
    int y = x + 1;
    if (y > 2) {
      return y;
    }
    return 0;
  }`;

  const parsed = await parseCSelection(source, { mode: "selection" });
  const flow = buildFlowModel(parsed);

  assert.equal(flow.nodes[0].kind, "start");
  assert.equal(flow.nodes.at(-1)?.kind, "terminator");
  assert.ok(flow.nodes.some((node) => node.kind === "decision" && node.label.includes("y > 2")));
  assert.ok(flow.nodes.some((node) => node.label.includes("return y")));
});

test("parses a selected C fragment by wrapping it in a synthetic function", async () => {
  const source = `int y = x + 1;
if (y > 2) {
  y++;
}
return y;`;

  const parsed = await parseCSelection(source, { mode: "selection" });
  const flow = buildFlowModel(parsed);

  assert.equal(parsed.syntheticWrapper, true);
  assert.ok(flow.nodes.some((node) => node.label.includes("int y = x + 1")));
  assert.ok(flow.nodes.some((node) => node.kind === "decision" && node.label.includes("y > 2")));
});

test("keeps return, break, and continue as terminal branch nodes", async () => {
  const source = `int sample(int x) {
    while (x > 0) {
      if (x == 3) {
        break;
      }
      if (x == 2) {
        continue;
      }
      return x;
    }
    return 0;
  }`;

  const parsed = await parseCSelection(source, { mode: "selection" });
  const flow = buildFlowModel(parsed);
  const breakNode = flow.nodes.find((node) => node.label === "break");
  const continueNode = flow.nodes.find((node) => node.label === "continue");
  const returnNode = flow.nodes.find((node) => node.label === "return x");

  assert.ok(breakNode);
  assert.ok(continueNode);
  assert.ok(returnNode);
  assert.equal(flow.edges.some((edge) => edge.from === breakNode.id && edge.to === returnNode.id), false);
  assert.equal(flow.edges.some((edge) => edge.from === continueNode.id && edge.to === returnNode.id), false);
});

test("lays out a four-level fixture with enough process fidelity for Visio verification", async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "four-level-80-step.c"), "utf8");
  const parsed = await parseCSelection(fixture, { mode: "selection" });
  const flow = buildFlowModel(parsed);
  const laidOut = layoutFlow(flow);

  assert.equal(parsed.syntheticWrapper, false);
  assert.ok(countFlowSteps(flow) >= 80, `expected at least 80 flow steps, got ${countFlowSteps(flow)}`);
  assert.ok(flow.nodes.filter((node) => node.kind === "decision").length >= 12);
  assert.ok(flow.nodes.some((node) => node.label.includes("switch (d)")));
  assert.ok(flow.edges.some((edge) => edge.label === "case 0"));
  assert.ok(flow.nodes.every((node) => Number.isFinite(laidOut.positions[node.id]?.x)));
  assert.ok(flow.nodes.every((node) => Number.isFinite(laidOut.positions[node.id]?.y)));
});
