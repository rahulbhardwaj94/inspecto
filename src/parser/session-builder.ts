/**
 * Builds a Session from raw JSONL records.
 *
 * Handles the core complexity of Claude Code's streaming format:
 * - Assistant turns are split across multiple JSONL records sharing the same
 *   `message.id`. Content blocks from each chunk are merged into one turn.
 * - Only the final chunk (stop_reason != null) has real output_tokens.
 * - Synthetic records (model: "<synthetic>") and errored turns are excluded.
 */

import type {
  AssistantRecord,
  ContentBlock,
  MergedTurn,
  RawRecord,
  Session,
  SKIP_TYPES,
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
 */
export async function buildSession(
  records: AsyncIterable<RawRecord>,
  sessionId: string,
  projectSlug: string,
): Promise<Session> {
  const assistantChunks = new Map<string, AssistantAccumulator>();
  const turns: MergedTurn[] = [];

  let cwd = "";
  let gitBranch: string | null = null;
  let model = "";
  let firstTimestamp = "";
  let lastTimestamp = "";

  for await (const record of records) {
    // Skip non-conversation record types
    if (isSkippable(record.type)) continue;

    if (record.type === "user") {
      const userRecord = record as UserRecord;
      handleUserRecord(userRecord, turns);
      captureMetadata(userRecord);
    } else if (record.type === "assistant") {
      const assistantRecord = record as AssistantRecord;

      // Skip synthetic context-management records
      if (assistantRecord.message.model === "<synthetic>") continue;
      // Skip errored API responses
      if (assistantRecord.error) continue;

      handleAssistantChunk(assistantRecord, assistantChunks);
      captureMetadata(assistantRecord);
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
    });
  }

  // Sort all turns by timestamp
  turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    id: sessionId,
    projectSlug,
    model,
    turns,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    cwd,
    gitBranch,
    durationMs: firstTimestamp && lastTimestamp
      ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
      : 0,
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

  function handleUserRecord(record: UserRecord, turns: MergedTurn[]) {
    const content = record.message.content;
    const isHumanTurn =
      typeof content === "string" && !record.isMeta;

    turns.push({
      role: "user",
      content: normalizeContent(content),
      usage: null,
      complete: true,
      timestamp: record.timestamp,
      isHumanTurn,
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

const SKIPPABLE = new Set([
  "queue-operation",
  "attachment",
  "system",
  "last-prompt",
]);

function isSkippable(type: string): boolean {
  return SKIPPABLE.has(type);
}
