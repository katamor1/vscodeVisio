import fs from "node:fs/promises";
import { parseCSelection } from "../parser/cSelectionParser";
import { buildFlowModel } from "../flow/flowModel";
import { layoutFlow } from "../layout/layoutGraph";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node out/src/cli/generateFlowJson.js <input.c> <output.json>");
  }

  const source = await fs.readFile(inputPath, "utf8");
  const parsed = await parseCSelection(source, { mode: "selection" });
  const flow = layoutFlow(buildFlowModel(parsed));
  await fs.writeFile(outputPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
