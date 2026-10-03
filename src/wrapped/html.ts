/**
 * Renders WrappedStats as a self-contained page of portrait "story" cards,
 * sized to screenshot and share. No external assets.
 *
 * Project and file names are hidden unless `showNames` is set: the page is
 * made to be shared, and names can leak what someone is working on.
 */

import { gradeLetterFromScore } from "../metrics/grader.js";
import { projectNameFromSlug } from "../utils/format.js";
import { VERSION } from "../version.js";
import type { Ranked, WrappedStats } from "./compute.js";

export interface WrappedHtmlOptions {
  showNames?: boolean;
}

export function renderWrappedHtml(s: WrappedStats, options: WrappedHtmlOptions = {}): string {
  const showNames = options.showNames ?? false;
  const projectName = (r: Ranked, i: number) =>
    showNames ? projectNameFromSlug(r.name) : `Project #${i + 1}`;
  const fileName = (r: Ranked) => (showNames ? r.name : maskFile(r.name));
  const grade = gradeLetterFromScore(s.avgScore);

  const cards = [
    card(
      "c1",
      `<p class="eyebrow">Claude Code Wrapped</p>
       <h1>Your ${s.year},<br>with an agent.</h1>
       <div class="mega">${compact(s.sessions)}</div>
       <p class="sub">${s.sessions === 1 ? "session" : "sessions"} · ${compact(Math.round(s.totalHours))} hours · ${s.activeDays} active ${s.activeDays === 1 ? "day" : "days"}</p>`,
    ),
    card(
      "c2",
      `<p class="eyebrow">What you built</p>
       <div class="mega">${compact(s.linesWritten)}</div>
       <p class="sub">lines written by your agent</p>
       <div class="grid2">
         ${stat(compact(s.filesEdited), "files edited")}
         ${stat(compact(s.outputTokens), "tokens generated")}
         ${stat(`$${s.totalCostUsd.toFixed(0)}`, "estimated spend")}
         ${stat(s.projectCount.toString(), s.projectCount === 1 ? "project" : "projects")}
       </div>`,
    ),
    card(
      "c3",
      `<p class="eyebrow">Your rhythm</p>
       <h2>${s.busiestWeekday ? `${esc(s.busiestWeekday)}s` : "Any day"}${s.busiestHour !== null ? ` at ${hourLabel(s.busiestHour)}` : ""}</h2>
       <p class="sub">is when you and Claude get the most done</p>
       ${heatmap(s.heatmap)}
       <div class="grid2">
         ${stat(`${s.longestStreak}`, s.longestStreak === 1 ? "day streak" : "day longest streak")}
         ${s.biggestDay ? stat(`${s.biggestDay.sessions}`, `sessions on ${esc(prettyDate(s.biggestDay.date))}`) : ""}
       </div>`,
    ),
    card(
      "c4",
      `<p class="eyebrow">Your toolbox</p>
       <h2>${s.topTools[0] ? esc(s.topTools[0].name) : "—"}</h2>
       <p class="sub">was your agent's favourite tool</p>
       ${bars(s.topTools)}
       ${s.topModels[0] ? `<p class="foot">Most-used model: <strong>${esc(s.topModels[0].name)}</strong></p>` : ""}`,
    ),
    card(
      "c5",
      `<p class="eyebrow">Your craft</p>
       <div class="mega">${esc(grade)}</div>
       <p class="sub">average session grade · score ${Math.round(s.avgScore)}/100</p>
       <div class="grid2">
         ${s.cacheHitRate !== null ? stat(`${Math.round(s.cacheHitRate * 100)}%`, "prompt cache hit rate") : ""}
         ${s.bestSession ? stat(esc(s.bestSession.letter), `best session, ${esc(prettyDate(s.bestSession.date))}`) : ""}
         ${s.topFiles[0] ? stat(esc(fileName(s.topFiles[0])), `most edited file · ${s.topFiles[0].count}×`) : ""}
         ${s.topProjects[0] ? stat(esc(projectName(s.topProjects[0], 0)), `top project · ${s.topProjects[0].count} sessions`) : ""}
       </div>`,
    ),
    card(
      "c6",
      `<p class="eyebrow">Your ${s.year} agent persona</p>
       <div class="emoji">${s.persona.emoji}</div>
       <h1>${esc(s.persona.name)}</h1>
       <p class="sub">${esc(s.persona.blurb)}</p>
       <div class="grid3">
         ${stat(compact(s.sessions), "sessions")}
         ${stat(compact(s.linesWritten), "lines")}
         ${stat(esc(grade), "avg grade")}
       </div>
       <p class="foot">npx inspecto wrapped · computed locally, nothing uploaded</p>`,
    ),
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code Wrapped ${s.year}</title>
<style>
  :root { --page: #f4f2ee; --ink: #16151a; --muted: #6b6870; }
  @media (prefers-color-scheme: dark) { :root { --page: #0d0c10; --ink: #f4f2ee; --muted: #9a97a0; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px 48px; background: var(--page); color: var(--ink);
    font: 16px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .deck { display: flex; flex-direction: column; align-items: center; gap: 28px; }
  .card { width: 100%; max-width: 420px; aspect-ratio: 4 / 5; border-radius: 28px; padding: 34px 30px;
    color: #fff; display: flex; flex-direction: column; justify-content: center; overflow: hidden;
    box-shadow: 0 18px 40px rgba(0,0,0,.18); position: relative; }
  .c1 { background: linear-gradient(150deg, #ff6b3d, #c2185b 60%, #4a148c); }
  .c2 { background: linear-gradient(160deg, #00897b, #004d40); }
  .c3 { background: linear-gradient(160deg, #3949ab, #1a237e); }
  .c4 { background: linear-gradient(160deg, #f9a825, #e65100); }
  .c5 { background: linear-gradient(160deg, #6a1b9a, #311b92); }
  .c6 { background: linear-gradient(150deg, #111, #2b2b2b 55%, #c2185b); text-align: center; align-items: center; }
  .eyebrow { margin: 0 0 14px; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; font-weight: 600; }
  h1 { margin: 0; font-size: 34px; line-height: 1.08; letter-spacing: -.02em; }
  h2 { margin: 0; font-size: 30px; line-height: 1.1; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .mega { font-size: 84px; font-weight: 800; line-height: 1; letter-spacing: -.04em; margin: 18px 0 6px; font-variant-numeric: tabular-nums; }
  .sub { margin: 6px 0 0; font-size: 16px; opacity: .9; }
  .grid2, .grid3 { display: grid; gap: 14px; margin-top: 26px; width: 100%; }
  .grid2 { grid-template-columns: 1fr 1fr; }
  .grid3 { grid-template-columns: 1fr 1fr 1fr; }
  .stat .v { font-size: 24px; font-weight: 750; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .stat .k { font-size: 12px; opacity: .78; }
  .bars { margin-top: 22px; display: flex; flex-direction: column; gap: 9px; }
  .bar { display: grid; grid-template-columns: 96px 1fr 44px; align-items: center; gap: 10px; font-size: 13px; }
  .bar .track { height: 10px; border-radius: 5px; background: rgba(255,255,255,.22); overflow: hidden; }
  .bar .fill { height: 100%; background: #fff; border-radius: 5px; }
  .bar .n { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
  .bar .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .heat { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin-top: 22px; }
  .heat i { aspect-ratio: 1; border-radius: 2px; background: #fff; }
  .heat-axis { display: flex; justify-content: space-between; font-size: 10px; opacity: .7; margin-top: 4px; }
  .emoji { font-size: 76px; line-height: 1; margin-bottom: 14px; }
  .foot { margin: 22px 0 0; font-size: 12px; opacity: .75; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 28px; }
</style>
</head>
<body>
<main class="deck">
${cards.join("\n")}
</main>
<footer>Generated by inspecto v${esc(VERSION)} from local Claude Code session logs. ${showNames ? "Project and file names are shown." : "Project and file names are hidden; use --names to show them."}</footer>
</body>
</html>
`;
}

function card(cls: string, body: string): string {
  return `<section class="card ${cls}">${body}</section>`;
}

function stat(value: string, label: string): string {
  return `<div class="stat"><div class="v">${value}</div><div class="k">${label}</div></div>`;
}

function bars(items: Ranked[]): string {
  if (items.length === 0) return "";
  const max = items[0].count;
  return `<div class="bars">${items
    .map(
      (t) =>
        `<div class="bar"><span class="name">${esc(t.name)}</span><span class="track"><span class="fill" style="display:block;width:${((t.count / max) * 100).toFixed(1)}%"></span></span><span class="n">${compact(t.count)}</span></div>`,
    )
    .join("")}</div>`;
}

function heatmap(grid: number[][]): string {
  const max = Math.max(1, ...grid.flat());
  const cells = grid
    .flatMap((row) => row.map((v) => `<i style="opacity:${v === 0 ? 0.12 : (0.3 + 0.7 * (v / max)).toFixed(2)}"></i>`))
    .join("");
  return `<div class="heat" role="img" aria-label="Sessions by weekday and hour">${cells}</div><div class="heat-axis"><span>Mon–Sun × 0h</span><span>12h</span><span>23h</span></div>`;
}

/** Keep the extension so the card stays fun without revealing the file. */
function maskFile(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `•••${name.slice(dot)}` : "•••";
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
