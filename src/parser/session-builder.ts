/**
 * Builds a Session from raw JSONL records.
 *
 * Handles the core complexity of Claude Code's streaming format:
 * - Assistant turns are split across multiple JSONL records sharing the same
 *   `message.id`. Content blocks from each chunk are merged into one turn.
 * - Only the final chunk (stop_reason != null) has real output_tokens.
 * - Synthetic records (model: "<synthetic>") and errored turns are excluded.
 */

import { basename } from "node:path";
import { readJsonl } from "./jsonl-reader.js";
import { SKIP_TYPES } from "./types.js";
import type {
  AssistantRecord,
  ContentBlock,
  MergedTurn,
  RawRecord,
  Session,
  UsageData,
  UserRecord,
} from "./types.js";

interface AssistantAccumulator {
  content: ContentBlock[];
  usage: UsageData | null;
  complete: boolean;
  timestamp: string;
  model: string;
}

/**
 * Build a processed Session from an async stream of raw records.
 * @param records - AsyncIterable of raw JSONL records (from readJsonl)
 * @param sessionId - The session ID (from filename)
 * @param projectSlug - The project slug (from parent directory name)
 * @param subagentPaths - Optional paths to subagent JSONL files to merge in
 */
export async function buildSession(
  records: AsyncIterable<RawRecord>,
  sessionId: string,
  projectSlug: string,
  subagentPaths?: string[],
): Promise<Session> {
  const turns: MergedTurn[] = [];
  const unknownRecordTypes = new Set<string>();

  let cwd = "";
  let gitBranch: string | null = null;
  let model = "";
  let firstTimestamp = "";
  let lastTimestamp = "";
  let formatVersion = "";

  async function processRecords(
    stream: AsyncIterable<RawRecord>,
    agentId: string | undefined,
  ) {
    const assistantChunks = new Map<string, AssistantAccumulator>();

    for await (const record of stream) {
      if (!formatVersion && "version" in record && typeof record.version === "string") {
        formatVersion = record.version;
      }

      if (SKIP_TYPES.has(record.type)) continue;

      if (record.type === "user") {
        const userRecord = record as UserRecord;
        handleUserRecord(userRecord, agentId);
        captureMetadata(userRecord);
      } else if (record.type === "assistant") {
        const assistantRecord = record as AssistantRecord;
        if (assistantRecord.message.model === "<synthetic>") continue;
        if (assistantRecord.error) continue;
        handleAssistantChunk(assistantRecord, assistantChunks);
        captureMetadata(assistantRecord);
      } else {
        unknownRecordTypes.add(record.type);
      }
    }

    // Flush all accumulated assistant chunks into turns
    for (const [, acc] of assistantChunks) {
      turns.push({
        role: "assistant",
        content: acc.content,
        usage: acc.usage,
        complete: acc.complete,
        timestamp: acc.timestamp,
        isHumanTurn: false,
        model: acc.model,
        agentId,
      });
    }
  }

  await processRecords(records, undefined);

  for (const agentPath of subagentPaths ?? []) {
    const agentId = basename(agentPath, ".jsonl");
    await processRecords(readJsonl(agentPath), agentId);
  }

  // Sort all turns (main + subagents) by timestamp
  turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const subagentIds = new Set(
    turns.filter((t) => t.agentId !== undefined).map((t) => t.agentId!),
  );
  const subagentTurnCount = turns.filter((t) => t.agentId !== undefined).length;

  return {
    id: sessionId,
    projectSlug,
    model,
    turns,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    cwd,
    gitBranch,
    durationMs:
      firstTimestamp && lastTimestamp
        ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
        : 0,
    subagentCount: subagentIds.size,
    subagentTurnCount,
    formatVersion,
    unknownRecordTypes,
  };

  // -- Inner helpers --------------------------------------------------------

  function captureMetadata(record: UserRecord | AssistantRecord) {
    if (!firstTimestamp && record.timestamp) {
      firstTimestamp = record.timestamp;
    }
    if (record.timestamp) {
      lastTimestamp = record.timestamp;
    }
    if (!cwd && record.cwd) {
      cwd = record.cwd;
    }
    if (gitBranch === null && record.gitBranch) {
      gitBranch = record.gitBranch;
    }
    if (!model && record.type === "assistant") {
      const ar = record as AssistantRecord;
      if (ar.message.model && ar.message.model !== "<synthetic>") {
        model = ar.message.model;
      }
    }
  }

  function handleUserRecord(record: UserRecord, agentId: string | undefined) {
    const content = record.message.content;
    const isHumanTurn = typeof content === "string" && !record.isMeta;
    turns.push({
      role: "user",
      content: normalizeContent(content),
      usage: null,
      complete: true,
      timestamp: record.timestamp,
      isHumanTurn,
      agentId,
    });
  }

  function handleAssistantChunk(
    record: AssistantRecord,
    chunks: Map<string, AssistantAccumulator>,
  ) {
    const messageId = record.message.id;
    let acc = chunks.get(messageId);

    if (!acc) {
      acc = {
        content: [],
        usage: null,
        complete: false,
        timestamp: record.timestamp,
        model: record.message.model,
      };
      chunks.set(messageId, acc);
    }

    // Append content blocks from this streaming chunk
    for (const block of record.message.content) {
      acc.content.push(block);
    }

    // Final chunk has the real usage data
    if (record.message.stop_reason !== null) {
      acc.complete = true;
      acc.usage = record.message.usage;
    }
  }
}

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}
