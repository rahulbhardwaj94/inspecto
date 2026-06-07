/**
 * Type definitions for Claude Code JSONL session data.
 *
 * Claude Code writes one JSONL file per session. Each line is a JSON record
 * with a discriminated `type` field. Assistant responses are streamed as
 * multiple chunks sharing the same `message.id` — only the final chunk
 * (with `stop_reason != null`) carries real token usage data.
 */

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

// ---------------------------------------------------------------------------
// Usage data (on assistant messages)
// ---------------------------------------------------------------------------

export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: {
    ephemeral_1h_input_tokens: number;
    ephemeral_5m_input_tokens: number;
  };
  server_tool_use?: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
  service_tier?: string;
  speed?: string;
}

// ---------------------------------------------------------------------------
// Raw JSONL record types (discriminated union on `type`)
// ---------------------------------------------------------------------------

export interface BaseRecord {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  version: string;
  cwd: string;
  type: string;
  isSidechain?: boolean;
  entrypoint?: string;
  gitBranch?: string | null;
  slug?: string;
  userType?: string;
  agentId?: string;
}

export interface UserRecord extends BaseRecord {
  type: "user";
  message: {
    role: "user";
    content: string | ContentBlock[];
  };
  isMeta?: boolean;
  permissionMode?: string;
}

export interface AssistantRecord extends BaseRecord {
  type: "assistant";
  requestId?: string;
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: ContentBlock[];
    stop_reason: "tool_use" | "end_turn" | "stop_sequence" | null;
    usage: UsageData;
  };
  error?: string;
  isApiErrorMessage?: boolean;
}

export interface QueueOperationRecord {
  type: "queue-operation";
  operation: string;
  timestamp: string;
  sessionId: string;
  content?: string;
}

export interface AttachmentRecord extends BaseRecord {
  type: "attachment";
  attachment: Record<string, unknown>;
}

export interface SystemRecord extends BaseRecord {
  type: "system";
  subtype?: string;
  [key: string]: unknown;
}

export interface LastPromptRecord {
  type: "last-prompt";
  lastPrompt: string;
  sessionId: string;
}

export type RawRecord =
  | UserRecord
  | AssistantRecord
  | QueueOperationRecord
  | AttachmentRecord
  | SystemRecord
  | LastPromptRecord;

/** Record types to skip during session building. */
export const SKIP_TYPES = new Set([
  "queue-operation",
  "attachment",
  "system",
  "last-prompt",
]);

// ---------------------------------------------------------------------------
// Processed session types (output of session builder)
// ---------------------------------------------------------------------------

export interface MergedTurn {
  role: "user" | "assistant";
  content: ContentBlock[];
  /** Real usage from the final streaming chunk. Null for user turns. */
  usage: UsageData | null;
  /** Whether the assistant turn completed (stop_reason was non-null). */
  complete: boolean;
  timestamp: string;
  /** True for human-authored user messages (not tool results or hook injections). */
  isHumanTurn: boolean;
  /** The model that generated this turn (assistant only). */
  model?: string;
  /** Subagent ID (e.g. "agent-abc123"). Undefined = main agent. */
  agentId?: string;
}

export interface Session {
  id: string;
  projectSlug: string;
  model: string;
  turns: MergedTurn[];
  startTime: string;
  endTime: string;
  cwd: string;
  gitBranch: string | null;
  durationMs: number;
  subagentCount: number;
  subagentTurnCount: number;
  formatVersion: string;
  unknownRecordTypes: Set<string>;
}

// ---------------------------------------------------------------------------
// Metric result types
// ---------------------------------------------------------------------------

export type MetricStatus = "healthy" | "warning" | "critical";

export interface MetricResult {
  name: string;
  value: number | null;
  status: MetricStatus;
  label: string;
  detail?: string;
}

export interface GradeResult {
  letter: string;
  score: number;
  metrics: MetricResult[];
}

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

export interface SessionFile {
  path: string;
  sessionId: string;
  projectSlug: string;
  mtime: Date;
  subagentPaths?: string[];
}
