import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFlowModel, type FlowModel } from "../src/flow/flowModel";
import { parseCSelection } from "../src/parser/cSelectionParser";
import { withTemporaryFlowJson } from "../src/extension/tempFlowJson";

async function buildFlow(source: string): Promise<FlowModel> {
  return buildFlowModel(await parseCSelection(source, { mode: "selection" }));
}

function readSampleCommentsFixture(): string {
  return fs.readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "sample-comments.c"), "utf8");
}

const TEST_KIND_WIDTH: Record<string, number> = {
  start: 2.2,
  process: 2.8,
  decision: 2.6,
  terminator: 2.2
};
const TEST_GROUP_PADDING_X = 0.45;

function testNodeHeight(label: string): number {
  return Math.max(0.55, 0.34 * label.split("\n").length + 0.25);
}

test("switch case without break falls through to the next case node", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 0:
        x++;
      case 1:
        x += 2;
        break;
      default:
        x = 9;
    }
    return x;
  }`);

  const firstCaseBody = flow.nodes.find((node) => node.label === "x++");
  const secondCase = flow.nodes.find((node) => node.label === "case 1");
  const secondCaseBody = flow.nodes.find((node) => node.label === "x += 2");
  const finalReturn = flow.nodes.find((node) => node.label === "return x");

  assert.ok(firstCaseBody);
  assert.equal(secondCase, undefined);
  assert.ok(secondCaseBody);
  assert.ok(finalReturn);
  assert.ok(flow.edges.some((edge) => edge.from === firstCaseBody.id && edge.to === secondCaseBody.id && edge.label === "Fallthrough"));
  assert.equal(flow.edges.some((edge) => edge.from === firstCaseBody.id && edge.to === finalReturn.id), false);
});

test("flow edges carry explicit directional connector ports", async () => {
  const flow = await buildFlow(`int f(int x) {
    if (x > 0) {
      x++;
    } else {
      x--;
    }
    while (x < 10) {
      if (x == 3) {
        continue;
      }
      if (x == 5) {
        break;
      }
      x += 2;
    }
    return x;
  }`);

  const ifNode = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("x > 0"));
  const thenNode = flow.nodes.find((node) => node.label === "x++");
  const elseNode = flow.nodes.find((node) => node.label === "x--");
  const whileNode = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("x < 10"));
  const bodyNode = flow.nodes.find((node) => node.label === "x += 2");
  const continueNode = flow.nodes.find((node) => node.label === "continue");

  assert.ok(ifNode);
  assert.ok(thenNode);
  assert.ok(elseNode);
  assert.ok(whileNode);
  assert.ok(bodyNode);
  assert.ok(continueNode);

  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === ifNode.id &&
        edge.to === thenNode.id &&
        edge.label === "Yes" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === ifNode.id &&
        edge.to === elseNode.id &&
        edge.label === "No" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === bodyNode.id &&
        edge.to === whileNode.id &&
        edge.label === "Next" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === continueNode.id &&
        edge.to === whileNode.id &&
        edge.label === "Continue" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(flow.edges.every((edge) => edge.fromPort === "bottom" || edge.fromPort === "right"));
  assert.ok(flow.edges.every((edge) => edge.toPort === "top"));
});

test("switch cases remain edge labels instead of process nodes", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 0:
      case 1:
        x += 1;
        break;
      default:
        x = 9;
    }
    return x;
  }`);

  const switchNode = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("switch"));
  const sharedCaseBody = flow.nodes.find((node) => node.label === "x += 1");
  const defaultBody = flow.nodes.find((node) => node.label === "x = 9");

  assert.ok(switchNode);
  assert.ok(sharedCaseBody);
  assert.ok(defaultBody);
  assert.equal(flow.nodes.some((node) => node.label === "case 0" || node.label === "case 1" || node.label === "default"), false);
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === switchNode.id &&
        edge.to === sharedCaseBody.id &&
        edge.label === "case 0" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === switchNode.id &&
        edge.to === sharedCaseBody.id &&
        edge.label === "case 1" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === switchNode.id &&
        edge.to === defaultBody.id &&
        edge.label === "default" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
});

test("layout places switch default case under the switch decision and other cases to the right", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 1:
        x += 1;
        break;
      case 2:
        x += 2;
        break;
      default:
        x = 9;
        break;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const switchNode = flow.nodes.find((node) => node.kind === "decision" && node.label === "switch\nx");
  const firstCaseBody = flow.nodes.find((node) => node.label === "x += 1");
  const secondCaseBody = flow.nodes.find((node) => node.label === "x += 2");
  const defaultBody = flow.nodes.find((node) => node.label === "x = 9");

  assert.ok(switchNode);
  assert.ok(firstCaseBody);
  assert.ok(secondCaseBody);
  assert.ok(defaultBody);
  assert.equal(laidOut.positions[defaultBody.id].x, laidOut.positions[switchNode.id].x);
  assert.ok(laidOut.positions[defaultBody.id].y < laidOut.positions[switchNode.id].y);
  assert.ok(laidOut.positions[firstCaseBody.id].x > laidOut.positions[switchNode.id].x);
  assert.ok(laidOut.positions[secondCaseBody.id].x > laidOut.positions[switchNode.id].x);
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === defaultBody.id && edge.label === "default" && edge.fromPort === "bottom"));
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === firstCaseBody.id && edge.label === "case 1" && edge.fromPort === "bottom"));
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === secondCaseBody.id && edge.label === "case 2" && edge.fromPort === "bottom"));
  assert.deepEqual(
    new Set(flow.edges.filter((edge) => edge.from === switchNode.id && edge.label).map((edge) => edge.fromPort)),
    new Set(["bottom"])
  );
});

test("layout places the last switch case under the switch decision when default is omitted", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 1:
        x += 1;
        break;
      case 2:
        x += 2;
        break;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const switchNode = flow.nodes.find((node) => node.kind === "decision" && node.label === "switch\nx");
  const firstCaseBody = flow.nodes.find((node) => node.label === "x += 1");
  const lastCaseBody = flow.nodes.find((node) => node.label === "x += 2");

  assert.ok(switchNode);
  assert.ok(firstCaseBody);
  assert.ok(lastCaseBody);
  assert.equal(laidOut.positions[lastCaseBody.id].x, laidOut.positions[switchNode.id].x);
  assert.ok(laidOut.positions[lastCaseBody.id].y < laidOut.positions[switchNode.id].y);
  assert.ok(laidOut.positions[firstCaseBody.id].x > laidOut.positions[switchNode.id].x);
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === lastCaseBody.id && edge.label === "case 2" && edge.fromPort === "bottom"));
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === firstCaseBody.id && edge.label === "case 1" && edge.fromPort === "bottom"));
  assert.deepEqual(
    new Set(flow.edges.filter((edge) => edge.from === switchNode.id && edge.label).map((edge) => edge.fromPort)),
    new Set(["bottom"])
  );
});

test("layout pins switch case labels near their branch rows instead of connector midpoints", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 1:
        x += 1;
        break;
      case 2:
        x += 2;
        break;
      default:
        x = 9;
        break;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const switchNode = flow.nodes.find((node) => node.kind === "decision" && node.label === "switch\nx");
  const firstCaseBody = flow.nodes.find((node) => node.label === "x += 1");
  const secondCaseBody = flow.nodes.find((node) => node.label === "x += 2");
  const defaultBody = flow.nodes.find((node) => node.label === "x = 9");

  assert.ok(switchNode);
  assert.ok(firstCaseBody);
  assert.ok(secondCaseBody);
  assert.ok(defaultBody);

  const case1 = laidOut.edges.find((edge) => edge.from === switchNode.id && edge.to === firstCaseBody.id && edge.label === "case 1");
  const case2 = laidOut.edges.find((edge) => edge.from === switchNode.id && edge.to === secondCaseBody.id && edge.label === "case 2");
  const defaultEdge = laidOut.edges.find((edge) => edge.from === switchNode.id && edge.to === defaultBody.id && edge.label === "default");
  type PositionedEdge = NonNullable<typeof case1> & {
    readonly labelPosition?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  };
  const case1Edge = case1 as PositionedEdge | undefined;
  const case2Edge = case2 as PositionedEdge | undefined;
  const defaultLabelEdge = defaultEdge as PositionedEdge | undefined;

  assert.ok(case1Edge?.labelPosition);
  assert.ok(case2Edge?.labelPosition);
  assert.ok(defaultLabelEdge?.labelPosition);
  assert.ok(case1Edge.labelPosition.x > laidOut.positions[switchNode.id].x);
  assert.ok(case1Edge.labelPosition.x < laidOut.positions[firstCaseBody.id].x);
  assert.ok(defaultLabelEdge.labelPosition.x > laidOut.positions[switchNode.id].x);
  assert.ok(defaultLabelEdge.labelPosition.x < laidOut.positions[firstCaseBody.id].x);
  assert.ok(case1Edge.labelPosition.y > case2Edge.labelPosition.y);
  assert.ok(case2Edge.labelPosition.y > defaultLabelEdge.labelPosition.y);
  assert.ok(defaultLabelEdge.labelPosition.y > laidOut.positions[defaultBody.id].y);
});

test("layout adds extra vertical clearance around decision diamonds", async () => {
  const flow = await buildFlow(`int f(int x) {
    x = 0;
    x += 1;
    if (x > 0) {
      x += 2;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const firstProcess = flow.nodes.find((node) => node.label === "x = 0");
  const secondProcess = flow.nodes.find((node) => node.label === "x += 1");
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label === "x > 0");
  const branchProcess = flow.nodes.find((node) => node.label === "x += 2");

  assert.ok(firstProcess);
  assert.ok(secondProcess);
  assert.ok(decision);
  assert.ok(branchProcess);

  const verticalClearance = (upper: typeof firstProcess, lower: typeof firstProcess) =>
    laidOut.positions[upper.id].y -
    laidOut.positions[lower.id].y -
    testNodeHeight(upper.label) / 2 -
    testNodeHeight(lower.label) / 2;
  const normalProcessClearance = verticalClearance(firstProcess, secondProcess);
  const aboveDecisionClearance = verticalClearance(secondProcess, decision);
  const belowDecisionClearance = verticalClearance(decision, branchProcess);

  assert.ok(aboveDecisionClearance >= normalProcessClearance * 1.8);
  assert.ok(belowDecisionClearance >= normalProcessClearance * 1.8);
});

test("layout pins yes and no labels near their decision diamond", async () => {
  const flow = await buildFlow(`int f(int x) {
    if (x > 0) {
      x += 1;
    } else {
      x += 2;
    }
    x += 3;
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label === "x > 0");
  const yesTarget = flow.nodes.find((node) => node.label === "x += 1");
  const noTarget = flow.nodes.find((node) => node.label === "x += 2");

  assert.ok(decision);
  assert.ok(yesTarget);
  assert.ok(noTarget);

  const yesEdge = laidOut.edges.find((edge) => edge.from === decision.id && edge.to === yesTarget.id && edge.label === "Yes");
  const noEdge = laidOut.edges.find((edge) => edge.from === decision.id && edge.to === noTarget.id && edge.label === "No");
  type PositionedEdge = NonNullable<typeof yesEdge> & {
    readonly labelPosition?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  };
  const positionedYes = yesEdge as PositionedEdge | undefined;
  const positionedNo = noEdge as PositionedEdge | undefined;

  assert.ok(positionedYes?.labelPosition);
  assert.ok(positionedNo?.labelPosition);
  assert.ok(
    Math.abs(positionedYes.labelPosition.x - laidOut.positions[decision.id].x) < 0.8,
    "bottom Yes label should stay near the decision x coordinate"
  );
  assert.ok(
    positionedYes.labelPosition.y < laidOut.positions[decision.id].y &&
      positionedYes.labelPosition.y > laidOut.positions[yesTarget.id].y,
    "bottom Yes label should sit between the decision and its target"
  );
  assert.ok(
    positionedNo.labelPosition.x > laidOut.positions[decision.id].x,
    "right No label should sit to the right of the decision"
  );
  assert.ok(
    Math.abs(positionedNo.labelPosition.y - laidOut.positions[decision.id].y) < 0.4,
    "right No label should stay near the decision y coordinate"
  );
});

test("switch case labels connect to the first statement inside braced case bodies", async () => {
  const flow = await buildFlow(`int f(int x) {
    switch (x) {
      case 0: {
        x += 1;
        break;
      }
      default: {
        x = 9;
        break;
      }
    }
    return x;
  }`);

  const switchNode = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("switch"));
  const firstCaseBody = flow.nodes.find((node) => node.label === "x += 1");
  const defaultBody = flow.nodes.find((node) => node.label === "x = 9");

  assert.ok(switchNode);
  assert.ok(firstCaseBody);
  assert.ok(defaultBody);
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === firstCaseBody.id && edge.label === "case 0"));
  assert.ok(flow.edges.some((edge) => edge.from === switchNode.id && edge.to === defaultBody.id && edge.label === "default"));
});

test("decision labels use compact condition text for if and multiline expression text for switch", async () => {
  const flow = await buildFlow(`int f(int x) {
    if (x > 0) {
      x++;
    }
    switch (x) {
      case 1:
        x += 2;
        break;
      default:
        x = 0;
    }
    return x;
  }`);

  assert.ok(flow.nodes.some((node) => node.kind === "decision" && node.label === "x > 0"));
  assert.ok(flow.nodes.some((node) => node.kind === "decision" && node.label === "switch\nx"));
  assert.equal(flow.nodes.some((node) => node.label === "if (x > 0)"), false);
  assert.equal(flow.nodes.some((node) => node.label === "switch (x)"), false);
});

test("layout routes upward loop edges from bottom while preserving non-upward right exits", async () => {
  const flow = await buildFlow(`int f(int x) {
    while (x < 5) {
      if (x == 3) {
        continue;
      }
      x++;
    }
    for (int i = 0; i < 2; i++) {
      x += i;
    }
    do {
      x--;
    } while (x > 0);
    if (x == 0) {
      x = 1;
    } else {
      x = 2;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);

  const whileNode = laidOut.nodes.find((node) => node.kind === "decision" && node.label.includes("x < 5"));
  const increment = laidOut.nodes.find((node) => node.label === "x++");
  const continueNode = laidOut.nodes.find((node) => node.label === "continue");
  const forCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label === "for\ni < 2");
  const forUpdate = laidOut.nodes.find((node) => node.label === "i++");
  const doCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label.includes("x > 0"));
  const doBody = laidOut.nodes.find((node) => node.label === "x--");
  const ifNode = laidOut.nodes.find((node) => node.kind === "decision" && node.label.includes("x == 0"));
  const elseNode = laidOut.nodes.find((node) => node.label === "x = 2");

  assert.ok(whileNode);
  assert.ok(increment);
  assert.ok(continueNode);
  assert.ok(forCondition);
  assert.ok(forUpdate);
  assert.ok(doCondition);
  assert.ok(doBody);
  assert.ok(ifNode);
  assert.ok(elseNode);

  const whileBackEdge = laidOut.edges.find((edge) => edge.from === increment.id && edge.to === whileNode.id && edge.label === "Next");
  const continueBackEdge = laidOut.edges.find((edge) => edge.from === continueNode.id && edge.to === whileNode.id && edge.label === "Continue");
  const forUpdateBackEdge = laidOut.edges.find((edge) => edge.from === forUpdate.id && edge.to === forCondition.id && edge.label === "Next");
  const doWhileBackEdge = laidOut.edges.find((edge) => edge.from === doCondition.id && edge.to === doBody.id && edge.label === "Yes");
  const nonUpwardNoEdge = laidOut.edges.find((edge) => edge.from === ifNode.id && edge.to === elseNode.id && edge.label === "No");

  assert.equal(whileBackEdge?.fromPort, "bottom");
  assert.equal(continueBackEdge?.fromPort, "bottom");
  assert.equal(forUpdateBackEdge?.fromPort, "bottom");
  assert.equal(doWhileBackEdge?.fromPort, "bottom");
  assert.equal(nonUpwardNoEdge?.fromPort, "right");
  assert.ok(laidOut.edges.every((edge) => edge.toPort === "top"));
});

test("do while executes the body before evaluating the loop condition", async () => {
  const flow = await buildFlow(`int f(void) {
    int x = 0;
    do {
      x++;
    } while (x < 3);
    return x;
  }`);

  const initializer = flow.nodes.find((node) => node.label === "int x = 0");
  const body = flow.nodes.find((node) => node.label === "x++");
  const condition = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("x < 3"));

  assert.ok(initializer);
  assert.ok(body);
  assert.ok(condition);
  assert.ok(flow.edges.some((edge) => edge.from === initializer.id && edge.to === body.id));
  assert.ok(flow.edges.some((edge) => edge.from === body.id && edge.to === condition.id));
});

test("temporary flow JSON is removed after Visio generation callback completes", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vscode-visio-test-"));
  const flow: FlowModel = {
    title: "temp",
    nodes: [{ id: "n1", kind: "start", label: "Start" }],
    edges: [],
    groups: []
  };
  let capturedPath = "";

  try {
    await withTemporaryFlowJson(flow, async (jsonPath) => {
      capturedPath = jsonPath;
      assert.equal(path.dirname(jsonPath).startsWith(tempRoot), true);
      assert.equal(fs.existsSync(jsonPath), true);
      const saved = JSON.parse((await fsp.readFile(jsonPath, "utf8")).replace(/^\uFEFF/, "")) as FlowModel;
      assert.equal(saved.title, "temp");
    }, tempRoot);

    assert.equal(fs.existsSync(capturedPath), false);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("extension package is scoped to Windows C files for Visio COM generation", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
    os?: string[];
    activationEvents?: string[];
    contributes?: { menus?: { "editor/context"?: Array<{ when?: string }> } };
  };

  assert.deepEqual(packageJson.os, ["win32"]);
  assert.equal(packageJson.activationEvents?.includes("onLanguage:cpp"), false);
  assert.equal(packageJson.contributes?.menus?.["editor/context"]?.[0]?.when, "editorLangId == c");
});

test("extension package main points at the compiled entrypoint", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
    main?: string;
    license?: string;
    repository?: { type?: string; url?: string };
    scripts?: Record<string, string>;
  };
  assert.ok(packageJson.main);

  const compiledEntrypoint = path.join(__dirname, "..", "..", packageJson.main);
  assert.equal(fs.existsSync(compiledEntrypoint), true);
  assert.equal(packageJson.scripts?.["vscode:prepublish"], "npm run compile");
  assert.equal(packageJson.license, "UNLICENSED");
  assert.equal(packageJson.repository?.type, "git");
  assert.match(packageJson.repository?.url ?? "", /^https:\/\/github\.com\/katamor1\/vscodeVisio\.git$/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "..", "LICENSE.txt")), true);
});

test("extension shows a progress notification as soon as Visio generation starts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "extension.ts"), "utf8");

  assert.match(source, /vscode\.window\.withProgress/);
  assert.match(source, /location:\s*vscode\.ProgressLocation\.Notification/);
  assert.match(source, /Visio: フローチャートを生成しています/);
});

test("whole function flow uses function signature start label and return end label", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);

  assert.equal(flow.nodes[0]?.label, "void sample(int flag, int value[], int *result)");
  assert.equal(flow.nodes[0]?.label.includes("Start:"), false);
  assert.equal(flow.nodes.at(-1)?.kind, "terminator");
  assert.equal(flow.nodes.at(-1)?.label, "return");
});

test("for loop split labels omit prefixes while keeping the condition under for", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);

  const initializer = flow.nodes.find((node) => node.label === "int i = 0");
  const condition = flow.nodes.find((node) => node.label === "for\ni < value[0]");
  const update = flow.nodes.find((node) => node.label === "i++");

  assert.equal(initializer?.kind, "process");
  assert.equal(condition?.kind, "decision");
  assert.equal(update?.kind, "process");
  assert.equal(flow.nodes.some((node) => node.label.startsWith("for init:")), false);
  assert.equal(flow.nodes.some((node) => node.label.startsWith("for condition:")), false);
  assert.equal(flow.nodes.some((node) => node.label.startsWith("for update:")), false);
});

test("no-else break guards inside for loops use the right port for the break branch", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label === "*result > 100");
  const thenNode = flow.nodes.find((node) => node.label === "*result = 100");
  const update = flow.nodes.find((node) => node.label === "i++");

  assert.ok(decision);
  assert.ok(thenNode);
  assert.ok(update);
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === decision.id &&
        edge.to === thenNode.id &&
        edge.label === "Yes" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === decision.id &&
        edge.to === update.id &&
        edge.label === "No" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.equal(
    flow.edges.some((edge) => edge.from === decision.id && edge.to === thenNode.id && edge.fromPort === "bottom"),
    false
  );
});

test("standalone comments are side notes only and are not process nodes", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const resultInit = flow.nodes.find((node) => node.label === "*result = 0");
  const sleep = flow.nodes.find((node) => node.label === "Sleep(1000)");
  const flagDecision = flow.nodes.find((node) => node.kind === "decision" && node.label === "flag");
  const waitLoop = flow.nodes.find((node) => node.kind === "decision" && node.label === "while (g_flag)");

  assert.equal(flow.nodes.some((node) => node.kind === "process" && node.label.trim().startsWith("//")), false);
  assert.equal(flow.nodes.some((node) => node.kind === "process" && node.label.trim().startsWith("/*")), false);
  assert.ok(resultInit?.comment);
  assert.ok(sleep?.comment);
  assert.equal(flagDecision?.comment, "フラグをチェック");
  assert.equal(
    waitLoop?.comment,
    "Wait until g_flag becomes false\nThis is a simple busy-wait loop that checks the value of g_flag every second.\nIn a real application, you might want to use a more efficient synchronization mechanism."
  );
});

test("return statement terminators do not connect to the generated function return", async () => {
  const flow = await buildFlow(`void f(int x) {
    while (x > 0) {
      if (x < 0) {
        return;
      }
      x--;
    }
  }`);
  const explicitReturn = flow.nodes.find((node) => node.kind === "terminator" && node.label === "return" && node.source);
  const generatedReturn = flow.nodes.find((node) => node.kind === "terminator" && node.label === "return" && !node.source);

  assert.ok(explicitReturn);
  assert.ok(generatedReturn);
  assert.equal(flow.edges.some((edge) => edge.from === explicitReturn.id), false);
  assert.ok(flow.edges.some((edge) => edge.to === generatedReturn.id));
});

test("statements after terminal flow exits are not rendered as reachable nodes", async () => {
  const flow = await buildFlow(`int f(int x) {
    if (x > 0) {
      return x;
      x++;
    }
    while (x < 10) {
      break;
      x += 2;
    }
    while (x < 20) {
      continue;
      x += 3;
    }
    return 0;
  }`);

  const returnNode = flow.nodes.find((node) => node.label === "return x");
  const breakNode = flow.nodes.find((node) => node.label === "break");
  const continueNode = flow.nodes.find((node) => node.label === "continue");

  assert.ok(returnNode);
  assert.ok(breakNode);
  assert.ok(continueNode);
  assert.equal(flow.nodes.some((node) => node.label === "x++"), false);
  assert.equal(flow.nodes.some((node) => node.label === "x += 2"), false);
  assert.equal(flow.nodes.some((node) => node.label === "x += 3"), false);
  assert.equal(flow.edges.some((edge) => edge.from === returnNode.id), false);
  assert.equal(flow.edges.some((edge) => edge.from === breakNode.id && edge.label === undefined), false);
  assert.ok(flow.edges.some((edge) => edge.from === continueNode.id && edge.label === "Continue"));
});

test("for header inline comments attach once to the condition node", async () => {
  const flow = await buildFlow(`void f(int n) {
    int total = 0;
    for (int i = 0; i < n; i++) // loop comment
    {
      total += i;
    }
  }`);

  const initializer = flow.nodes.find((node) => node.label === "int i = 0");
  const condition = flow.nodes.find((node) => node.label === "for\ni < n");
  const update = flow.nodes.find((node) => node.label === "i++");

  assert.equal(initializer?.comment, undefined);
  assert.equal(condition?.comment, "loop comment");
  assert.equal(update?.comment, undefined);
});

test("layout leaves clearance between loop body group boxes and following nodes", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const sleep = laidOut.nodes.find((node) => node.label === "Sleep(1000)");
  const generatedReturn = laidOut.nodes.find((node) => node.kind === "terminator" && node.label === "return" && !node.source);
  const whileGroup = laidOut.groupBoxes.find((box) => sleep?.id && box.nodeIds.includes(sleep.id));

  assert.ok(sleep);
  assert.ok(generatedReturn);
  assert.ok(whileGroup);
  assert.ok(laidOut.positions[sleep.id].y - laidOut.positions[generatedReturn.id].y >= 1.35);
  assert.ok(whileGroup.bottom - (laidOut.positions[generatedReturn.id].y + 0.3) >= 0.25);
});

test("loop body group boxes shift right of their owner condition nodes without widening", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);

  assert.ok(laidOut.groupBoxes.length > 0);
  for (const box of laidOut.groupBoxes) {
    const ownerPosition = laidOut.positions[box.ownerNodeId];
    assert.ok(ownerPosition, `missing loop owner position for ${box.id}`);
    const boxCenterX = (box.left + box.right) / 2;
    const members = box.nodeIds.map((nodeId) => laidOut.nodes.find((node) => node.id === nodeId)).filter((node) => node !== undefined);
    const memberLeft = Math.min(
      ...members.map((node) => laidOut.positions[node.id].x - TEST_KIND_WIDTH[node.kind] / 2 - TEST_GROUP_PADDING_X)
    );
    const memberRight = Math.max(
      ...members.map((node) => laidOut.positions[node.id].x + TEST_KIND_WIDTH[node.kind] / 2 + TEST_GROUP_PADDING_X)
    );

    assert.ok(boxCenterX > ownerPosition.x, `${box.id} center ${boxCenterX} must be right of owner ${ownerPosition.x}`);
    assert.equal(Math.round((box.right - box.left) * 1000), Math.round((memberRight - memberLeft) * 1000));
  }
});

test("loop bodies are exposed as rectangular groups in layout output", async () => {
  const flow = await buildFlow(`int f(void) {
    int x = 0;
    for (int i = 0; i < 2; i++) {
      x += i;
      while (x < 10) {
        x++;
      }
    }
    do {
      x--;
    } while (x > 0);
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);

  assert.equal(flow.groups.length, 3);
  assert.equal(laidOut.groupBoxes.length, 3);
  const labelsInGroups = flow.groups.map((group) =>
    group.nodeIds.map((nodeId) => flow.nodes.find((node) => node.id === nodeId)?.label).filter(Boolean)
  );

  assert.ok(labelsInGroups.some((labels) => labels.includes("x += i")));
  assert.ok(labelsInGroups.some((labels) => labels.includes("x++")));
  assert.ok(labelsInGroups.some((labels) => labels.includes("x--")));
  assert.ok(laidOut.groupBoxes.every((box) => box.right > box.left && box.top > box.bottom));
});

test("layout routes loop-back edges through dummy nodes outside only their own loop box", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const upwardEdges = laidOut.edges.filter((edge) => laidOut.positions[edge.to]?.y > laidOut.positions[edge.from]?.y);

  assert.ok(upwardEdges.length > 0);
  for (const edge of upwardEdges) {
    const from = laidOut.positions[edge.from];
    const to = laidOut.positions[edge.to];
    const ownLoopBox = laidOut.groupBoxes.find((box) => box.ownerNodeId === edge.to || box.ownerNodeId === edge.from);
    const containingBoxes = ownLoopBox
      ? laidOut.groupBoxes.filter(
          (box) =>
            box.id !== ownLoopBox.id &&
            box.left < ownLoopBox.left &&
            box.right > ownLoopBox.right &&
            box.top > ownLoopBox.top &&
            box.bottom < ownLoopBox.bottom
        )
      : [];
    const routeNode = edge.routeNode;

    assert.ok(ownLoopBox, `missing owning loop box for ${edge.from}->${edge.to}`);
    assert.ok(routeNode, `missing loop-back dummy node for ${edge.from}->${edge.to}`);
    assert.match(routeNode.id, /^route-/);
    assert.equal((routeNode as typeof routeNode & { orientation?: string }).orientation, "vertical");
    assert.equal((routeNode as typeof routeNode & { inPort?: string }).inPort, "bottom");
    assert.equal((routeNode as typeof routeNode & { outPort?: string }).outPort, "top");
    assert.ok(routeNode.x < ownLoopBox.left, `route node ${edge.from}->${edge.to} should stay left of its own loop box`);
    assert.ok(
      containingBoxes.every((box) => routeNode.x > box.left),
      `nested route node ${edge.from}->${edge.to} should remain inside containing loop boxes`
    );
    assert.ok(routeNode.y > Math.min(from.y, to.y));
    assert.ok(routeNode.y <= Math.max(from.y, to.y) + 0.5);
  }
});

test("layout routes loop condition exits through right-side dummy nodes outside their loop box", async () => {
  const flow = await buildFlow(`int f(int x) {
    while (x < 10) {
      x++;
    }
    for (int i = 0; i < 3; i++) {
      x += i;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const whileCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label.includes("x < 10"));
  const forCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label === "for\ni < 3");
  const returnNode = laidOut.nodes.find((node) => node.kind === "terminator" && node.label === "return x");
  const forInit = laidOut.nodes.find((node) => node.label === "int i = 0");

  assert.ok(whileCondition);
  assert.ok(forCondition);
  assert.ok(returnNode);
  assert.ok(forInit);

  for (const [condition, target] of [
    [whileCondition, forInit],
    [forCondition, returnNode]
  ] as const) {
    const loopBox = laidOut.groupBoxes.find((box) => box.ownerNodeId === condition.id);
    const exitEdge = laidOut.edges.find((edge) => edge.from === condition.id && edge.to === target.id && edge.label === "No");

    assert.ok(loopBox, `missing loop box for ${condition.label}`);
    assert.ok(exitEdge, `missing condition exit edge for ${condition.label}`);
    assert.equal(exitEdge.fromPort, "right");
    assert.ok(exitEdge.routeNode, `missing right-side dummy node for ${condition.label}`);
    assert.equal((exitEdge.routeNode as typeof exitEdge.routeNode & { orientation?: string }).orientation, "vertical");
    assert.equal((exitEdge.routeNode as typeof exitEdge.routeNode & { inPort?: string }).inPort, "top");
    assert.equal((exitEdge.routeNode as typeof exitEdge.routeNode & { outPort?: string }).outPort, "bottom");
    assert.ok(exitEdge.routeNode.x > loopBox.right, `dummy node for ${condition.label} should be right of its loop box`);
    assert.ok(
      laidOut.positions[target.id].x - TEST_KIND_WIDTH[target.kind] / 2 >= exitEdge.routeNode.x,
      `target node for ${condition.label} should be fully right of its right-side dummy node`
    );
    assert.ok(
      laidOut.positions[target.id].x >= exitEdge.routeNode.x,
      `target node for ${condition.label} should be at or right of its right-side dummy node`
    );
    assert.ok(exitEdge.routeNode.y < loopBox.top, `dummy node for ${condition.label} should stay beside the loop box`);
    assert.ok(exitEdge.routeNode.y > loopBox.bottom, `dummy node for ${condition.label} should stay beside the loop box`);
  }
});

test("layout keeps extra vertical clearance before loop condition inputs", async () => {
  const flow = await buildFlow(`int f(int x) {
    x = x + 1;
    while (x < 10) {
      x++;
    }
    for (int i = 0; i < 3; i++) {
      x += i;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const beforeWhile = laidOut.nodes.find((node) => node.label === "x = x + 1");
  const whileCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label.includes("x < 10"));
  const forInit = laidOut.nodes.find((node) => node.label === "int i = 0");
  const forCondition = laidOut.nodes.find((node) => node.kind === "decision" && node.label === "for\ni < 3");

  assert.ok(beforeWhile);
  assert.ok(whileCondition);
  assert.ok(forInit);
  assert.ok(forCondition);
  assert.ok(
    laidOut.positions[beforeWhile.id].y - laidOut.positions[whileCondition.id].y > 1.3,
    "while condition should have more than the normal vertical spacing from upstream input"
  );
  assert.ok(
    laidOut.positions[forInit.id].y - laidOut.positions[forCondition.id].y > 1.3,
    "for condition should have more than the normal vertical spacing from upstream input"
  );
});

test("layout keeps loop condition diamonds clear of their loop body boxes", async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "four-level-80-step.c"), "utf8");
  const flow = await buildFlow(fixture);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const topTestedLoopBoxes = laidOut.groupBoxes.filter((box) => {
    const owner = laidOut.positions[box.ownerNodeId];
    return owner !== undefined && owner.y > box.top;
  });

  assert.ok(topTestedLoopBoxes.length > 0);
  for (const box of topTestedLoopBoxes) {
    const owner = laidOut.nodes.find((node) => node.id === box.ownerNodeId);
    assert.ok(owner);
    const ownerBottom = laidOut.positions[owner.id].y - testNodeHeight(owner.label) / 2;
    assert.ok(
      ownerBottom >= box.top + 0.12,
      `loop condition ${owner.label} should not overlap its loop body box`
    );
  }
});

test("layout keeps nested loop condition exit targets right of finalized dummy nodes", async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "four-level-80-step.c"), "utf8");
  const flow = await buildFlow(fixture);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const conditionExitEdges = laidOut.edges.filter((edge) => {
    const box = laidOut.groupBoxes.find((groupBox) => groupBox.ownerNodeId === edge.from && !groupBox.nodeIds.includes(edge.to));
    return box !== undefined && edge.routeNode !== undefined;
  });

  assert.ok(conditionExitEdges.length > 0);
  for (const edge of conditionExitEdges) {
    const target = laidOut.nodes.find((node) => node.id === edge.to);
    assert.ok(target);
    assert.ok(edge.routeNode);
    assert.equal((edge.routeNode as typeof edge.routeNode & { orientation?: string }).orientation, "vertical");
    assert.equal((edge.routeNode as typeof edge.routeNode & { inPort?: string }).inPort, "top");
    assert.equal((edge.routeNode as typeof edge.routeNode & { outPort?: string }).outPort, "bottom");
    assert.ok(
      laidOut.positions[edge.to].x - TEST_KIND_WIDTH[target.kind] / 2 >= edge.routeNode.x,
      `target ${edge.to} should be fully right of finalized route node for ${edge.from}->${edge.to}`
    );
  }
});

test("sample.c places counter declaration and generated return to the right of loop exits", async () => {
  const sample = fs.readFileSync(path.join(__dirname, "..", "..", "samples", "sample.c"), "utf8");
  const flow = await buildFlow(sample);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const counter = laidOut.nodes.find((node) => node.label === "int counter = 0");
  const generatedReturn = laidOut.nodes.find((node) => node.kind === "terminator" && node.label === "return" && !node.source);

  assert.ok(counter);
  assert.ok(generatedReturn);
  assert.equal(laidOut.groupBoxes.some((box) => box.nodeIds.includes(counter.id)), false);
  assert.equal(laidOut.groupBoxes.some((box) => box.nodeIds.includes(generatedReturn.id)), false);

  for (const target of [counter, generatedReturn]) {
    const routeEdge = laidOut.edges.find(
      (edge) =>
        edge.to === target.id &&
        edge.routeNode !== undefined &&
        laidOut.groupBoxes.some((box) => box.ownerNodeId === edge.from && !box.nodeIds.includes(edge.to))
    );
    assert.ok(routeEdge, `missing loop exit route to ${target.label}`);
    assert.ok(routeEdge.routeNode);
    assert.equal((routeEdge.routeNode as typeof routeEdge.routeNode & { orientation?: string }).orientation, "vertical");
    assert.equal((routeEdge.routeNode as typeof routeEdge.routeNode & { inPort?: string }).inPort, "top");
    assert.equal((routeEdge.routeNode as typeof routeEdge.routeNode & { outPort?: string }).outPort, "bottom");
    assert.ok(
      laidOut.positions[target.id].x - TEST_KIND_WIDTH[target.kind] / 2 >= routeEdge.routeNode.x,
      `${target.label} should be fully right of its loop exit dummy node`
    );
  }

  assert.ok(
    laidOut.positions[counter.id].y > laidOut.positions[generatedReturn.id].y,
    "counter declaration should remain above the generated terminal return"
  );
});

test("Visio renderer marks connector end direction with arrowheads", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /EndArrow/);
  assert.match(script, /BeginArrow/);
});

test("Visio renderer creates and uses named flow connection points", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /FlowTop/);
  assert.match(script, /FlowBottom/);
  assert.doesNotMatch(script, /FlowTopLeftLoop/);
  assert.doesNotMatch(script, /FlowBottomLeftLoop/);
  assert.match(script, /FlowRight/);
  assert.match(script, /FlowLeft/);
  assert.match(script, /Get-FlowBeginPortCell/);
  assert.match(script, /Get-FlowEndPortCell/);
  assert.doesNotMatch(script, /leftLoopBack/);
  assert.match(script, /Connections\.FlowLeft\.X/);
  assert.doesNotMatch(script, /\$toPort/);
  assert.match(script, /SectionExists\(7, 0\)/);
  assert.match(script, /AddNamedRow\(7, \$Name, 185\)/);
  assert.doesNotMatch(script, /GlueTo\(\$shapeById\[\$edge\.from\]\.CellsU\("PinX"\)\)/);
  assert.doesNotMatch(script, /GlueTo\(\$shapeById\[\$edge\.to\]\.CellsU\("PinX"\)\)/);
});

test("Visio renderer splits routed edges through slender oriented dummy nodes", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /New-RouteDummyNode/);
  assert.match(script, /Get-RouteDummyPorts/);
  assert.match(script, /RouteNode\.orientation/);
  assert.match(script, /RouteNode\.inPort/);
  assert.match(script, /RouteNode\.outPort/);
  assert.match(script, /"vertical"\s+\{\s+\$widthFormula = "0\.005 in"\s+\$heightFormula = "0\.24 in"/);
  assert.match(script, /\$heightFormula = "0\.005 in"/);
  assert.match(script, /"vertical"\s+\{\s+return @\{ In = "bottom"; Out = "top" \}/);
  assert.match(script, /In = \[string\]\$RouteNode\.inPort/);
  assert.match(script, /Out = \[string\]\$RouteNode\.outPort/);
  assert.match(script, /return @\{ In = "left"; Out = "right" \}/);
  assert.match(script, /LinePattern" -Formula "1"/);
  assert.match(script, /LineColor" -Formula "RGB\(0,0,0\)"/);
  assert.match(script, /\$edge\.routeNode/);
  assert.match(script, /\$firstConnector/);
  assert.match(script, /\$secondConnector/);
  assert.match(script, /-EndArrow "0"/);
  assert.match(script, /-EndArrow "4"/);
  assert.match(script, /\$Page\.Drop\(\$ConnectorMaster, 0, 0\)/);
  assert.doesNotMatch(script, /New-RoutedPolyline/);
  assert.doesNotMatch(script, /DrawPolyline/);
  assert.doesNotMatch(script, /New-LeftLoopBackPolyline/);
  assert.doesNotMatch(script, /Get-LoopBackLeftX/);
  assert.match(script, /"left"\s+\{\s+return \$Shape\.CellsU\("Connections\.FlowLeft\.X"\)\s+\}/);
  assert.doesNotMatch(script, /-ToPort "right"/);
});

test("Visio renderer configures dynamic connector routing and keeps nodes in front", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /RouteStyle" -Formula "5"/);
  assert.match(script, /LineToNodeX/);
  assert.match(script, /LineToNodeY/);
  assert.match(script, /LineToLineX/);
  assert.match(script, /LineToLineY/);
  assert.match(script, /ObjType" -Formula "1"/);
  assert.match(script, /ObjType" -Formula "2"/);
  assert.match(script, /ShapeRouteStyle" -Formula "5"/);
  assert.match(script, /BringToFront\(\)/);
});

test("Visio verification counts only generated flow steps with source-backed terminators", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "Verify-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /\$_\.kind -ne "start"/);
  assert.match(script, /\!\(\$_.kind -eq "terminator" -and -not \$_.source\)/);
  assert.doesNotMatch(script, /\$_\.label -ne "End"/);
});

test("break and continue are rendered as decision diamonds while preserving loop control", async () => {
  const flow = await buildFlow(`int f(int x) {
    while (x > 0) {
      if (x == 3) {
        break;
      }
      if (x == 2) {
        continue;
      }
      x--;
    }
    return x;
  }`);
  const breakNode = flow.nodes.find((node) => node.label === "break");
  const continueNode = flow.nodes.find((node) => node.label === "continue");

  assert.equal(breakNode?.kind, "decision");
  assert.equal(continueNode?.kind, "decision");
  assert.ok(flow.edges.some((edge) => edge.from === continueNode?.id && edge.label === "Continue"));
  assert.ok(flow.edges.some((edge) => edge.from === breakNode?.id && edge.to !== continueNode?.id));
});

test("loop break return and continue paths use right decision outputs before loop-back paths", async () => {
  const flow = await buildFlow(`int f(int x) {
    while (x < 10) {
      if (x == 5) {
        break;
      }
      if (x == 7) {
        return x;
      }
      if (x == 6) {
        continue;
      }
      x++;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);

  const breakGuard = flow.nodes.find((node) => node.kind === "decision" && node.label === "x == 5");
  const breakNode = flow.nodes.find((node) => node.label === "break");
  const returnGuard = flow.nodes.find((node) => node.kind === "decision" && node.label === "x == 7");
  const returnNodes = flow.nodes.filter((node) => node.label === "return x" && node.source);
  const loopReturn = returnNodes[0];
  const continueGuard = flow.nodes.find((node) => node.kind === "decision" && node.label === "x == 6");
  const continueNode = flow.nodes.find((node) => node.label === "continue");
  const increment = flow.nodes.find((node) => node.label === "x++");
  const finalReturn = returnNodes[1];

  assert.ok(breakGuard);
  assert.ok(breakNode);
  assert.ok(returnGuard);
  assert.ok(loopReturn);
  assert.ok(continueGuard);
  assert.ok(continueNode);
  assert.ok(increment);
  assert.ok(finalReturn);
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === breakGuard.id &&
        edge.to === breakNode.id &&
        edge.label === "Yes" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === breakGuard.id &&
        edge.to === returnGuard.id &&
        edge.label === "No" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === breakNode.id &&
        edge.to === finalReturn.id &&
        edge.label === "Break" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === returnGuard.id &&
        edge.to === loopReturn.id &&
        edge.label === "Yes" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === returnGuard.id &&
        edge.to === continueGuard.id &&
        edge.label === "No" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === continueGuard.id &&
        edge.to === continueNode.id &&
        edge.label === "Yes" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === continueGuard.id &&
        edge.to === increment.id &&
        edge.label === "No" &&
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(laidOut.positions[breakNode.id].x > laidOut.positions[breakGuard.id].x);
  assert.ok(laidOut.positions[loopReturn.id].x > laidOut.positions[returnGuard.id].x);
  assert.ok(laidOut.positions[continueNode.id].x > laidOut.positions[continueGuard.id].x);
});

test("for loops are split into initializer, condition, and update steps", async () => {
  const flow = await buildFlow(`int f(void) {
    int sum = 0;
    for (int i = 0; i < 3; i++) {
      sum += i;
    }
    return sum;
  }`);
  const initializer = flow.nodes.find((node) => node.label === "int i = 0");
  const condition = flow.nodes.find((node) => node.label === "for\ni < 3");
  const body = flow.nodes.find((node) => node.label === "sum += i");
  const update = flow.nodes.find((node) => node.label === "i++");

  assert.equal(initializer?.kind, "process");
  assert.equal(condition?.kind, "decision");
  assert.equal(update?.kind, "process");
  assert.ok(flow.edges.some((edge) => edge.from === initializer?.id && edge.to === condition?.id));
  assert.ok(flow.edges.some((edge) => edge.from === condition?.id && edge.to === body?.id && edge.label === "Yes"));
  assert.ok(flow.edges.some((edge) => edge.from === body?.id && edge.to === update?.id));
  assert.ok(flow.edges.some((edge) => edge.from === update?.id && edge.to === condition?.id && edge.label === "Next"));
  assert.ok(flow.groups.some((group) => body?.id && group.nodeIds.includes(body.id) && !group.nodeIds.includes(initializer!.id)));
});

test("comments above or to the right of source statements are placed as node comments", async () => {
  const flow = await buildFlow(`int f(void) {
    int x = 0;
    // 日本語の前行コメント
    x += 1; // English inline comment
    /* English block comment */
    y += x;
    if (x > 0) { // decision comment is not a process note
      x--;
    }
    return x;
  }`);
  const increment = flow.nodes.find((node) => node.label === "x += 1");
  const assignment = flow.nodes.find((node) => node.label === "y += x");
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("x > 0"));

  assert.equal(increment?.comment, "日本語の前行コメント\nEnglish inline comment");
  assert.equal(assignment?.comment, "English block comment");
  assert.equal(decision?.comment, "decision comment is not a process note");
});

test("layout places comment text to the right of the associated process node", async () => {
  const flow = await buildFlow(`int f(void) {
    // comment
    x += 1;
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const processNode = flow.nodes.find((node) => node.label === "x += 1");

  assert.ok(processNode);
  assert.ok(laidOut.commentPositions[processNode.id]);
  assert.ok(laidOut.commentPositions[processNode.id].x > laidOut.positions[processNode.id].x);
  assert.equal(laidOut.commentPositions[processNode.id].y, laidOut.positions[processNode.id].y);
});

test("layout places decision comments diagonally above the right output lane", async () => {
  const flow = await buildFlow(`int f(int x) {
    if (x > 0) { // decision comment
      x--;
    }
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label.includes("x > 0"));

  assert.ok(decision);
  const comment = laidOut.commentPositions[decision.id] as (typeof laidOut.commentPositions)[string] & {
    height?: number;
  };
  assert.ok(comment);
  assert.ok(comment.height);
  assert.ok(comment.x > laidOut.positions[decision.id].x);
  assert.ok(
    comment.y - comment.height / 2 > laidOut.positions[decision.id].y,
    "decision comment bottom should sit above the decision center line"
  );
});

test("layout sizes comment text boxes from comment text length and line count", async () => {
  const flow = await buildFlow(`int f(void) {
    // short
    x += 1;
    // this is a much longer comment text that should need a wider text box
    x += 2;
    // first line
    // second line
    x += 3;
    return x;
  }`);
  const { layoutFlow } = await import("../src/layout/layoutGraph");
  const laidOut = layoutFlow(flow);
  const shortNode = flow.nodes.find((node) => node.label === "x += 1");
  const longNode = flow.nodes.find((node) => node.label === "x += 2");
  const multilineNode = flow.nodes.find((node) => node.label === "x += 3");

  assert.ok(shortNode);
  assert.ok(longNode);
  assert.ok(multilineNode);

  const shortComment = laidOut.commentPositions[shortNode.id] as (typeof laidOut.commentPositions)[string] & {
    width?: number;
    height?: number;
  };
  const longComment = laidOut.commentPositions[longNode.id] as (typeof laidOut.commentPositions)[string] & {
    width?: number;
    height?: number;
  };
  const multilineComment = laidOut.commentPositions[multilineNode.id] as (typeof laidOut.commentPositions)[string] & {
    width?: number;
    height?: number;
  };

  assert.ok(shortComment.width && shortComment.height);
  assert.ok(longComment.width && longComment.height);
  assert.ok(multilineComment.width && multilineComment.height);
  assert.ok(longComment.width > shortComment.width, "longer comment should get a wider text box");
  assert.ok(multilineComment.height > shortComment.height, "multiline comment should get a taller text box");
  assert.ok(laidOut.page.width >= longComment.x + longComment.width / 2);
});

test("Visio renderer draws comment text without an outer border", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /commentPositions/);
  assert.match(script, /LinePattern" -Formula "0"/);
});

test("Visio renderer uses dynamic comment text box dimensions from layout JSON", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /\$commentWidth = if \(\$commentPosition\.width\)/);
  assert.match(script, /\$commentHeight = if \(\$commentPosition\.height\)/);
  assert.match(script, /\[double\]\$commentPosition\.x - \$commentWidth \/ 2/);
  assert.match(script, /\[double\]\$commentPosition\.y - \$commentHeight \/ 2/);
  assert.doesNotMatch(script, /\[double\]\$commentPosition\.x - 1\.45/);
  assert.doesNotMatch(script, /\[double\]\$commentPosition\.y - 0\.32/);
});

test("Visio renderer draws positioned edge labels separately from connectors", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /New-EdgeLabelText/);
  assert.match(script, /\$edge\.labelPosition/);
  assert.match(script, /\$connectorLabel = if \(\(Test-ConnectorLabelVisible -Label \$edge\.label\) -and -not \$edge\.labelPosition\)/);
  assert.match(script, /-Label \$connectorLabel/);
});

test("Visio renderer suppresses redundant break and continue connector labels", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /Test-ConnectorLabelVisible/);
  assert.match(script, /"Break",\s*"Continue"/);
  assert.match(script, /\$connectorLabel = if \(\(Test-ConnectorLabelVisible -Label \$edge\.label\) -and -not \$edge\.labelPosition\)/);
});
