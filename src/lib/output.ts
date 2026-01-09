import chalk from "chalk";

/**
 * Exit codes for CLI commands
 */
export const ExitCode = {
  SUCCESS: 0,
  CONFLICT: 1,
  NOT_FOUND: 2,
  NOT_GIT_REPO: 3,
  NETWORK_ERROR: 4,
  DIRTY_WORKSPACE: 5,
  TIMEOUT: 6,
  NO_CHANGES: 7,
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Output options for commands
 */
export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Output data to console based on options
 */
export function output(data: unknown, options: OutputOptions): void {
  if (options.quiet) return;

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Pretty print for human consumption
    prettyPrint(data);
  }
}

/**
 * Pretty print data for human consumption
 */
function prettyPrint(data: unknown): void {
  if (typeof data === "string") {
    console.log(data);
    return;
  }

  if (typeof data !== "object" || data === null) {
    console.log(data);
    return;
  }

  const obj = data as Record<string, unknown>;

  // Handle status messages
  if ("status" in obj) {
    const status = obj.status as string;
    if (status === "deployed" || status === "applied" || status === "completed") {
      console.log(chalk.green(`✓ ${status}`));
    } else if (status === "fetched") {
      console.log(chalk.blue(`✓ ${status}`));
    } else if (status === "discarded") {
      console.log(chalk.yellow(`✓ ${status}`));
    } else {
      console.log(chalk.dim(`Status: ${status}`));
    }
  }

  // Print other fields
  for (const [key, value] of Object.entries(obj)) {
    if (key === "status") continue;
    if (key === "error") {
      console.log(chalk.red(`Error: ${value}`));
      continue;
    }

    if (Array.isArray(value)) {
      console.log(chalk.dim(`${formatKey(key)}: ${value.length} items`));
      for (const item of value.slice(0, 10)) {
        console.log(chalk.dim(`  - ${typeof item === "object" ? JSON.stringify(item) : item}`));
      }
      if (value.length > 10) {
        console.log(chalk.dim(`  ... and ${value.length - 10} more`));
      }
    } else if (typeof value === "object" && value !== null) {
      console.log(chalk.dim(`${formatKey(key)}:`));
      for (const [subKey, subValue] of Object.entries(value)) {
        console.log(chalk.dim(`  ${formatKey(subKey)}: ${subValue}`));
      }
    } else {
      console.log(chalk.dim(`${formatKey(key)}: ${value}`));
    }
  }
}

/**
 * Format a camelCase or snake_case key for display
 */
function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Exit with an error code and message
 */
export function exitWithError(
  code: ExitCodeType,
  error: ErrorResponse,
  options: OutputOptions
): never {
  if (options.quiet) {
    process.exit(code);
  }

  if (options.json) {
    console.log(JSON.stringify(error, null, 2));
  } else {
    console.log(chalk.red(`\nError: ${error.message || error.error}`));
    if (error.files && Array.isArray(error.files)) {
      for (const file of error.files) {
        console.log(chalk.dim(`  - ${file}`));
      }
    }
  }

  process.exit(code);
}

/**
 * Success exit
 */
export function exitSuccess(data: unknown, options: OutputOptions): never {
  output(data, options);
  process.exit(ExitCode.SUCCESS);
}
