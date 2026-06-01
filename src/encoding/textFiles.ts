import fs from "node:fs/promises";
import { TextDecoder } from "node:util";

export type CSourceEncoding = "utf8" | "utf8bom" | "shift_jis";

export interface DecodedCSource {
  readonly text: string;
  readonly encoding: CSourceEncoding;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function decodeCSourceBuffer(source: Buffer | Uint8Array): DecodedCSource {
  const buffer = Buffer.from(source);
  if (startsWithUtf8Bom(buffer)) {
    return {
      encoding: "utf8bom",
      text: decodeUtf8Strict(buffer.subarray(UTF8_BOM.length))
    };
  }

  try {
    return {
      encoding: "utf8",
      text: decodeUtf8Strict(buffer)
    };
  } catch {
    return {
      encoding: "shift_jis",
      text: new TextDecoder("shift_jis").decode(buffer)
    };
  }
}

export async function readCSourceFile(filePath: string): Promise<DecodedCSource> {
  return decodeCSourceBuffer(await fs.readFile(filePath));
}

export async function writeJsonUtf8Bom(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, encodeUtf8Bom(`${JSON.stringify(value, null, 2)}\n`));
}

export function encodeUtf8Bom(text: string): Buffer {
  return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
}

function startsWithUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= UTF8_BOM.length && buffer[0] === UTF8_BOM[0] && buffer[1] === UTF8_BOM[1] && buffer[2] === UTF8_BOM[2];
}

function decodeUtf8Strict(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}
