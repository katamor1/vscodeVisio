import { parseCSelection } from "../parser/cSelectionParser";
import { buildFlowModel } from "../flow/flowModel";
import { layoutFlow } from "../layout/layoutGraph";
import { readCSourceFile, writeJsonUtf8Bom } from "../encoding/textFiles";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node out/src/cli/generateFlowJson.js <input.c> <output.json>");
  }

  const { text: source } = await readCSourceFile(inputPath);
  const parsed = await parseCSelection(source, { mode: "selection" });
  const flow = layoutFlow(buildFlowModel(parsed));
  await writeJsonUtf8Bom(outputPath, flow);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
