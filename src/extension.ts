import cp from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { withTemporaryFlowJson } from "./extension/tempFlowJson";
import { buildFlowModel } from "./flow/flowModel";
import { layoutFlow } from "./layout/layoutGraph";
import { parseCSelection } from "./parser/cSelectionParser";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vscodeVisio.generateFlowchartFromSelection", async () => {
      try {
        await generateFlowchart(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Visio flowchart generation failed: ${message}`);
      }
    })
  );
}

export function deactivate(): void {
  // VS Code calls this on extension shutdown.
}

async function generateFlowchart(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Open a C file before generating a Visio flowchart.");
    return;
  }

  const document = editor.document;
  const config = vscode.workspace.getConfiguration("vscodeVisio");
  const selectedText = document.getText(editor.selection);
  const parsed =
    selectedText.trim().length > 0
      ? await parseCSelection(selectedText, { mode: "selection" })
      : await parseCSelection(document.getText(), { mode: "document", cursorOffset: document.offsetAt(editor.selection.active) });
  const flow = layoutFlow(buildFlowModel(parsed));

  const outputDirectory = await resolveOutputDirectory(config.get<string>("outputDirectory") ?? "visio-output", document);
  await fs.mkdir(outputDirectory, { recursive: true });
  const baseName = `${sanitizeBaseName(path.basename(document.fileName, path.extname(document.fileName)))}-${Date.now()}`;
  const outputVsdxPath = path.join(outputDirectory, `${baseName}.vsdx`);

  const stencilPath =
    config.get<string>("visioStencilPath") ??
    "C:\\Program Files\\Microsoft Office\\Root\\Office16\\Visio Content\\1041\\BASFLO_M.VSSX";
  const scriptPath = path.join(context.extensionPath, "scripts", "New-VisioFlowchart.ps1");
  await withTemporaryFlowJson(flow, async (flowJsonPath) => {
    await runPowerShell(scriptPath, ["-InputJson", flowJsonPath, "-OutputVsdx", outputVsdxPath, "-StencilPath", stencilPath]);
  });

  if (config.get<boolean>("openAfterGenerate") === true) {
    await vscode.env.openExternal(vscode.Uri.file(outputVsdxPath));
  }
  vscode.window.showInformationMessage(`Generated Visio flowchart: ${outputVsdxPath}`);
}

async function resolveOutputDirectory(configuredPath: string, document: vscode.TextDocument): Promise<string> {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const root = workspaceFolder?.uri.fsPath ?? path.dirname(document.fileName);
  return path.join(root, configuredPath);
}

function sanitizeBaseName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_") || "selection";
}

function runPowerShell(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Visio generation failed with exit code ${code ?? "unknown"}.\n${stdout}\n${stderr}`));
      }
    });
  });
}
