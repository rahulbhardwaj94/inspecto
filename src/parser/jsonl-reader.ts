/**
 * Streaming JSONL reader using Node's readline + createReadStream.
 * Processes files line-by-line to handle 100MB+ session files without
 * loading them into memory.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RawRecord } from "./types.js";

/**
 * Stream-reads a JSONL file, yielding one parsed record per line.
 * Malformed lines are silently skipped (common near session end during crashes).
 */
export async function* readJsonl(filePath: string): AsyncGenerator<RawRecord> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      const record = JSON.parse(trimmed) as RawRecord;
      if (record && typeof record === "object" && "type" in record) {
        yield record;
      }
    } catch {
      // Skip malformed lines — common at session boundaries
    }
  }
}
