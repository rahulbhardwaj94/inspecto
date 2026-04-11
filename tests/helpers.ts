/**
 * Test helpers for loading fixture sessions.
 */

import { join } from "node:path";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { buildSession } from "../src/parser/session-builder.js";
import type { Session } from "../src/parser/types.js";

const FIXTURES_DIR = join(__dirname, "fixtures");

export async function loadFixture(name: string): Promise<Session> {
  const path = join(FIXTURES_DIR, `${name}.jsonl`);
  const records = readJsonl(path);
  return buildSession(records, name, "test-project");
}

export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, `${name}.jsonl`);
}
