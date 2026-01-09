import chalk from "chalk";
import ora from "ora";
import { loadGlobalConfig, loadProjectConfig } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";

export interface SessionsOptions {
  limit?: number;
  withBundle?: boolean;
  json?: boolean;
}

export async function sessionsCommand(options: SessionsOptions): Promise<void> {
  const globalConfig = loadGlobalConfig();
  if (!globalConfig?.apiKey) {
    console.log(chalk.red("Not logged in. Run 'chucky login' first."));
    process.exit(1);
  }

  const projectConfig = loadProjectConfig();
  const projectId = projectConfig?.projectId;

  const api = new ChuckyApi(globalConfig.apiKey);
  const spinner = options.json ? null : ora("Fetching sessions...").start();

  try {
    const result = await api.listSessions({
      limit: options.limit || 20,
      withBundle: options.withBundle,
      projectId: projectId || undefined,
    });

    spinner?.stop();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.sessions.length === 0) {
      console.log(chalk.yellow("No sessions found."));
      return;
    }

    console.log(chalk.bold(`\nSessions${projectId ? ` (project: ${projectConfig?.name})` : " (all projects)"}:\n`));

    for (const session of result.sessions) {
      const statusColor = session.status === "completed" ? chalk.green :
                          session.status === "failed" ? chalk.red :
                          chalk.yellow;

      const bundleIndicator = session.has_bundle ? chalk.cyan(" [bundle]") : "";
      const duration = session.duration_ms ? `${(session.duration_ms / 1000).toFixed(1)}s` : "-";
      const cost = session.total_cost_usd ? `$${session.total_cost_usd.toFixed(4)}` : "-";

      console.log(
        chalk.dim(session.id.slice(0, 8)) + " " +
        statusColor(session.status.padEnd(10)) +
        chalk.dim(` ${duration.padStart(6)} `) +
        chalk.dim(`${cost.padStart(8)} `) +
        chalk.dim(session.user_id.padEnd(16).slice(0, 16)) +
        bundleIndicator +
        (session.job_id ? chalk.dim(` job:${session.job_id.slice(0, 8)}`) : "")
      );
    }

    console.log(chalk.dim(`\nShowing ${result.sessions.length} sessions`));
    if (result.pagination.hasMore) {
      console.log(chalk.dim(`Use --limit to see more`));
    }
  } catch (error) {
    spinner?.fail("Failed to fetch sessions");
    console.log(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}
