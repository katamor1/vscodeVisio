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
  const finalReturn = flow.nodes.find((node) => node.label === "return x");

  assert.ok(firstCaseBody);
  assert.ok(secondCase);
  assert.ok(finalReturn);
  assert.ok(flow.edges.some((edge) => edge.from === firstCaseBody.id && edge.to === secondCase.id));
  assert.equal(flow.edges.some((edge) => edge.from === firstCaseBody.id && edge.to === finalReturn.id), false);
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
    edges: []
  };
  let capturedPath = "";

  try {
    await withTemporaryFlowJson(flow, async (jsonPath) => {
      capturedPath = jsonPath;
      assert.equal(path.dirname(jsonPath).startsWith(tempRoot), true);
      assert.equal(fs.existsSync(jsonPath), true);
      const saved = JSON.parse(await fsp.readFile(jsonPath, "utf8")) as FlowModel;
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
