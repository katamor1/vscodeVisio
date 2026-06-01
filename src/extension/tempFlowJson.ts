import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LaidOutFlow } from "../layout/layoutGraph";
import type { FlowModel } from "../flow/flowModel";

export async function withTemporaryFlowJson<T>(
  flow: FlowModel | LaidOutFlow,
  callback: (jsonPath: string) => Promise<T>,
  rootDirectory = os.tmpdir()
): Promise<T> {
  const tempDirectory = await fs.mkdtemp(path.join(rootDirectory, "vscode-visio-"));
  const jsonPath = path.join(tempDirectory, "flow.json");

  try {
    await fs.writeFile(jsonPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
    return await callback(jsonPath);
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}
