import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decodeCSourceBuffer } from "../src/encoding/textFiles";
import { withTemporaryFlowJson } from "../src/extension/tempFlowJson";
import type { FlowModel } from "../src/flow/flowModel";

test("decodes UTF-8 C source without changing Japanese string literals", () => {
  const decoded = decodeCSourceBuffer(Buffer.from('int f(void) { log("開始"); return 0; }', "utf8"));

  assert.equal(decoded.encoding, "utf8");
  assert.match(decoded.text, /開始/);
});

test("decodes UTF-8 BOM C source and strips the BOM before parsing", () => {
  const decoded = decodeCSourceBuffer(Buffer.from('\uFEFFint f(void) { log("開始"); return 0; }', "utf8"));

  assert.equal(decoded.encoding, "utf8bom");
  assert.equal(decoded.text.charCodeAt(0), "i".charCodeAt(0));
  assert.match(decoded.text, /開始/);
});

test("decodes Shift-JIS C source when UTF-8 validation fails", () => {
  const shiftJisSource = Buffer.from([
    ...Buffer.from('int f(void) { log("', "ascii"),
    0x8a,
    0x4a,
    0x8e,
    0x6e,
    ...Buffer.from('"); return 0; }', "ascii")
  ]);
  const decoded = decodeCSourceBuffer(shiftJisSource);

  assert.equal(decoded.encoding, "shift_jis");
  assert.match(decoded.text, /開始/);
});

test("temporary Visio handoff JSON is written with a UTF-8 BOM for Windows PowerShell", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vscode-visio-encoding-"));
  const flow: FlowModel = {
    title: "encoding",
    nodes: [{ id: "n1", kind: "process", label: 'log("開始")' }],
    edges: [],
    groups: []
  };

  try {
    await withTemporaryFlowJson(flow, async (jsonPath) => {
      const raw = await fsp.readFile(jsonPath);
      assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.match(raw.toString("utf8"), /開始/);
    }, tempRoot);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});
