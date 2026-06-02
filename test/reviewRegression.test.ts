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
        edge.fromPort === "right" &&
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

test("layout routes upward loop edges from left while preserving non-upward right exits", async () => {
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

  assert.equal(whileBackEdge?.fromPort, "left");
  assert.equal(continueBackEdge?.fromPort, "left");
  assert.equal(forUpdateBackEdge?.fromPort, "left");
  assert.equal(doWhileBackEdge?.fromPort, "left");
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

test("no-else if exits inside for loops keep the No branch on the right port", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const decision = flow.nodes.find((node) => node.kind === "decision" && node.label === "if (*result > 100)");
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
        edge.fromPort === "bottom" &&
        edge.toPort === "top"
    )
  );
  assert.ok(
    flow.edges.some(
      (edge) =>
        edge.from === decision.id &&
        edge.to === update.id &&
        edge.label === "No" &&
        edge.fromPort === "right" &&
        edge.toPort === "top"
    )
  );
  assert.equal(
    flow.edges.some((edge) => edge.from === decision.id && edge.to === update.id && edge.fromPort === "bottom"),
    false
  );
});

test("standalone comments are side notes only and are not process nodes", async () => {
  const fixture = readSampleCommentsFixture();
  const flow = await buildFlow(fixture);
  const resultInit = flow.nodes.find((node) => node.label === "*result = 0");
  const sleep = flow.nodes.find((node) => node.label === "Sleep(1000)");
  const flagDecision = flow.nodes.find((node) => node.kind === "decision" && node.label === "if (flag)");
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

test("Visio renderer keeps loop-back edges as dynamic connectors from the left port", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.doesNotMatch(script, /New-LeftLoopBackPolyline/);
  assert.doesNotMatch(script, /DrawPolyline/);
  assert.doesNotMatch(script, /Get-LoopBackLeftX/);
  assert.match(script, /"left"\s+\{\s+return \$Shape\.CellsU\("Connections\.FlowLeft\.X"\)\s+\}/);
  assert.match(script, /\$connector = \$page\.Drop\(\$masters\.connector, 0, 0\)/);
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

test("Visio renderer draws comment text without an outer border", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "New-VisioFlowchart.ps1"), "utf8");

  assert.match(script, /commentPositions/);
  assert.match(script, /LinePattern" -Formula "0"/);
});
