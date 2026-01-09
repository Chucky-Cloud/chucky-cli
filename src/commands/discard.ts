import chalk from "chalk";
import { resolve } from "node:path";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi, isJobId } from "../lib/api.js";
import { discardBranch } from "../lib/git.js";
import { output, type OutputOptions } from "../lib/output.js";

export interface DiscardOptions {
  json?: boolean;
  quiet?: boolean;
}

export async function discardCommand(
  id: string,
  options: DiscardOptions
): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  const isSession = !isJobId(id);

  const apiKey = requireApiKey();
  const projectConfig = requireProjectConfig();
  const api = new ChuckyApi(apiKey);
  const folder = projectConfig.folder || ".";
  const fullPath = resolve(folder);

  // Resolve partial session IDs
  const resolvedId = isSession ? await api.resolveSessionId(id, projectConfig.projectId) : id;
  const branchName = isSession ? `chucky/session-${resolvedId}` : `chucky/job-${resolvedId}`;

  // Use short ID for display
  const shortId = isSession ? resolvedId.slice(0, 8) : resolvedId;

  // Discard is idempotent - doesn't fail if branch doesn't exist
  discardBranch(fullPath, branchName);

  const result = {
    status: "discarded",
    [isSession ? "session_id" : "job_id"]: resolvedId,
  };

  if (options.json || options.quiet) {
    output(result, outputOpts);
  } else {
    console.log(chalk.yellow(`Discarded changes for ${isSession ? "session" : "job"} ${shortId}`));
  }
}
