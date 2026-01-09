import { fetchCommand, type FetchOptions } from "./fetch.js";
import { applyCommand, type ApplyOptions } from "./apply.js";

export interface PullOptions {
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export async function pullCommand(
  id: string,
  options: PullOptions
): Promise<void> {
  // Pull is just fetch + apply
  const fetchOpts: FetchOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  const applyOpts: ApplyOptions = {
    force: options.force,
    json: options.json,
    quiet: options.quiet,
  };

  // Fetch first
  await fetchCommand(id, fetchOpts);

  // Then apply
  await applyCommand(id, applyOpts);
}
