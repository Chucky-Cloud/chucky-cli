import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { glob } from "glob";
import type { ToolResult } from "@chucky.cloud/sdk";

/**
 * Helper to create a text result
 */
function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Helper to create an error result
 */
function errorResult(error: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${error}` }], isError: true };
}

/**
 * Execute HostBash tool
 */
export async function executeHostBash(
  input: { command: string; cwd?: string; timeout?: number },
  baseCwd: string
): Promise<ToolResult> {
  const { command, cwd, timeout = 30000 } = input;
  const workingDir = cwd ? resolve(baseCwd, cwd) : baseCwd;

  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd: workingDir,
      env: process.env,
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
      if (code !== 0) {
        resolve(errorResult(output || `Process exited with code ${code}`));
      } else {
        resolve(textResult(output || "(no output)"));
      }
    });

    proc.on("error", (err) => {
      resolve(errorResult(`Failed to execute command: ${err.message}`));
    });
  });
}

/**
 * Execute HostRead tool
 */
export async function executeHostRead(
  input: { path: string; encoding?: BufferEncoding },
  baseCwd: string
): Promise<ToolResult> {
  const { path: filePath, encoding = "utf-8" } = input;
  const fullPath = resolve(baseCwd, filePath);

  if (!existsSync(fullPath)) {
    return errorResult(`File not found: ${fullPath}`);
  }

  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    return errorResult(`Path is a directory, not a file: ${fullPath}`);
  }

  try {
    const content = readFileSync(fullPath, encoding);
    return textResult(content);
  } catch (err) {
    return errorResult(`Failed to read file: ${(err as Error).message}`);
  }
}

/**
 * Execute HostWrite tool
 */
export async function executeHostWrite(
  input: { path: string; content: string; encoding?: BufferEncoding },
  baseCwd: string
): Promise<ToolResult> {
  const { path: filePath, content, encoding = "utf-8" } = input;
  const fullPath = resolve(baseCwd, filePath);

  try {
    writeFileSync(fullPath, content, encoding);
    return textResult(`Successfully wrote ${content.length} characters to ${fullPath}`);
  } catch (err) {
    return errorResult(`Failed to write file: ${(err as Error).message}`);
  }
}

/**
 * Execute HostEdit tool
 */
export async function executeHostEdit(
  input: { path: string; old_string: string; new_string: string; replace_all?: boolean },
  baseCwd: string
): Promise<ToolResult> {
  const { path: filePath, old_string, new_string, replace_all = false } = input;
  const fullPath = resolve(baseCwd, filePath);

  if (!existsSync(fullPath)) {
    return errorResult(`File not found: ${fullPath}`);
  }

  try {
    let content = readFileSync(fullPath, "utf-8");

    if (!content.includes(old_string)) {
      return errorResult(
        `String not found in file: "${old_string.slice(0, 50)}${old_string.length > 50 ? "..." : ""}"`
      );
    }

    const occurrences = content.split(old_string).length - 1;

    if (replace_all) {
      content = content.split(old_string).join(new_string);
    } else {
      if (occurrences > 1) {
        return errorResult(
          `Found ${occurrences} occurrences of the string. Set replace_all=true or provide more context to make it unique.`
        );
      }
      content = content.replace(old_string, new_string);
    }

    writeFileSync(fullPath, content, "utf-8");
    return textResult(
      `Successfully edited ${fullPath}${replace_all ? ` (${occurrences} replacements)` : ""}`
    );
  } catch (err) {
    return errorResult(`Failed to edit file: ${(err as Error).message}`);
  }
}

/**
 * Execute HostGlob tool
 */
export async function executeHostGlob(
  input: { pattern: string; cwd?: string; ignore?: string[] },
  baseCwd: string
): Promise<ToolResult> {
  const { pattern, cwd, ignore = ["node_modules/**", ".git/**"] } = input;
  const workingDir = cwd ? resolve(baseCwd, cwd) : baseCwd;

  try {
    const files = await glob(pattern, {
      cwd: workingDir,
      ignore,
      nodir: true,
    });

    return textResult(files.length > 0 ? files.join("\n") : "(no files found)");
  } catch (err) {
    return errorResult(`Glob search failed: ${(err as Error).message}`);
  }
}

/**
 * Execute HostGrep tool
 */
export async function executeHostGrep(
  input: {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    maxResults?: number;
  },
  baseCwd: string
): Promise<ToolResult> {
  const {
    pattern,
    path: searchPath = ".",
    glob: fileGlob = "**/*",
    ignoreCase = false,
    maxResults = 100,
  } = input;

  const workingDir = resolve(baseCwd, searchPath);

  try {
    const regex = new RegExp(pattern, ignoreCase ? "gi" : "g");

    const files = await glob(fileGlob, {
      cwd: workingDir,
      ignore: ["node_modules/**", ".git/**"],
      nodir: true,
    });

    const results: string[] = [];

    for (const file of files) {
      if (results.length >= maxResults) break;

      const fullPath = join(workingDir, file);
      try {
        const stat = statSync(fullPath);
        if (stat.size > 1024 * 1024) continue; // Skip files > 1MB

        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (regex.test(lines[i])) {
            results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return textResult(results.length > 0 ? results.join("\n") : "(no matches found)");
  } catch (err) {
    return errorResult(`Grep search failed: ${(err as Error).message}`);
  }
}
