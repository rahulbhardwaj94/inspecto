import chalk from "chalk";
import Table from "cli-table3";
import { scanSessions } from "../parser/project-scanner.js";
import { formatDuration, shortSessionId } from "../utils/format.js";

export interface ListOptions {
  sessions?: boolean;
  project?: string;
  dataDir?: string;
}

const TABLE_CHARS = {
  top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
  bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
  left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
  right: "", "right-mid": "", middle: "  ",
};

const TABLE_STYLE = { head: [], border: [], "padding-left": 2, "padding-right": 2 };

export async function runList(options: ListOptions): Promise<void> {
  const sessionFiles = await scanSessions({
    dataDir: options.dataDir,
    project: options.project,
  });

  if (sessionFiles.length === 0) {
    console.log("No sessions found.");
    return;
  }

  if (options.sessions || options.project) {
    const toShow = options.project ? sessionFiles : sessionFiles.slice(0, 20);

    const lines: string[] = [""];
    if (options.project) {
      lines.push(chalk.bold(`  Sessions for ${options.project}`) + chalk.dim(` (${toShow.length})`));
    } else {
      lines.push(chalk.bold("  20 most recent sessions"));
    }
    lines.push("");

    const table = new Table({
      head: ["Session", "Project", "Date", "Duration"].map((h) => chalk.dim(h)),
      style: TABLE_STYLE,
      chars: TABLE_CHARS,
    });

    for (const sf of toShow) {
      const dateStr = sf.mtime.toISOString().slice(0, 10);
      let durStr = "—";
      if (
        sf.birthtime &&
        sf.birthtime.getTime() > 0 &&
        sf.birthtime.getTime() < sf.mtime.getTime()
      ) {
        durStr = formatDuration(sf.mtime.getTime() - sf.birthtime.getTime());
      }
      table.push([shortSessionId(sf.sessionId), sf.projectSlug, dateStr, durStr]);
    }

    lines.push(table.toString());
    lines.push("");
    console.log(lines.join("\n"));
  } else {
    // Group by project, sorted by most recent session
    const projectMap = new Map<string, { count: number; lastActive: Date }>();
    for (const sf of sessionFiles) {
      const existing = projectMap.get(sf.projectSlug);
      if (!existing) {
        projectMap.set(sf.projectSlug, { count: 1, lastActive: sf.mtime });
      } else {
        existing.count++;
        if (sf.mtime > existing.lastActive) existing.lastActive = sf.mtime;
      }
    }

    const projects = [...projectMap.entries()].sort(
      (a, b) => b[1].lastActive.getTime() - a[1].lastActive.getTime(),
    );

    const lines: string[] = [""];
    lines.push(chalk.bold("  Projects") + chalk.dim(` (${projects.length} found)`));
    lines.push("");

    const table = new Table({
      head: ["Project", "Sessions", "Last active"].map((h) => chalk.dim(h)),
      style: TABLE_STYLE,
      chars: TABLE_CHARS,
    });

    for (const [slug, info] of projects) {
      table.push([slug, info.count.toString(), info.lastActive.toISOString().slice(0, 10)]);
    }

    lines.push(table.toString());
    lines.push("");
    console.log(lines.join("\n"));
  }
}
