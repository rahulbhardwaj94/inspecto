import { describe, it, expect } from "vitest";
import { readJsonl } from "../../src/parser/jsonl-reader.js";
import { fixturePath } from "../helpers.js";

describe("readJsonl", () => {
  it("streams records from a valid JSONL file", async () => {
    const records = [];
    for await (const record of readJsonl(fixturePath("minimal-session"))) {
      records.push(record);
    }
    expect(records.length).toBe(2);
    expect(records[0].type).toBe("user");
    expect(records[1].type).toBe("assistant");
  });

  it("reads all records from the healthy fixture", async () => {
    const records = [];
    for await (const record of readJsonl(fixturePath("healthy-session"))) {
      records.push(record);
    }
    expect(records.length).toBeGreaterThan(20);
  });
});
