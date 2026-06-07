import type { GradeResult } from "../parser/types.js";
import type { RegressionResult } from "../anomaly/regression-detector.js";

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(fields: (string | number | null)[]): string {
  return fields.map(csvEscape).join(",");
}

export function exportAuditCsv(grade: GradeResult): string {
  const lines: string[] = [];
  lines.push(csvRow(["name", "value", "status", "label"]));
  for (const metric of grade.metrics) {
    lines.push(csvRow([metric.name, metric.value, metric.status, metric.label]));
  }
  return lines.join("\n");
}

export function exportTrendCsv(results: RegressionResult[]): string {
  const lines: string[] = [];
  lines.push(csvRow(["name", "recentAvg", "fullAvg", "changePercent", "status"]));
  for (const r of results) {
    lines.push(csvRow([r.name, r.recentAvg, r.fullAvg, r.changePercent, r.status]));
  }
  return lines.join("\n");
}
