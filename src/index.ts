#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { listCommand } from "./commands/list.js";
import { initCommand } from "./commands/init.js";
import { deployCommand } from "./commands/deploy.js";
import { keysCommand } from "./commands/keys.js";
import { configAnthropicCommand } from "./commands/config.js";
import { deleteCommand } from "./commands/delete.js";
import { promptCommand } from "./commands/prompt.js";
import { createJobsCommand } from "./commands/jobs.js";
import { fetchCommand } from "./commands/fetch.js";
import { diffCommand } from "./commands/diff.js";
import { logCommand } from "./commands/log.js";
import { applyCommand } from "./commands/apply.js";
import { discardCommand } from "./commands/discard.js";
import { waitCommand } from "./commands/wait.js";
import { pullCommand } from "./commands/pull.js";
import { sessionsCommand } from "./commands/sessions.js";

const program = new Command();

program
  .name("chucky")
  .description("CLI for deploying workspaces to Chucky cloud")
  .version("0.2.9");

// Login command
program
  .command("login")
  .description("Authenticate with your Chucky account")
  .option("-k, --key <key>", "API key (ak_live_...)")
  .action(loginCommand);

// List command
program
  .command("list")
  .alias("ls")
  .description("List all projects")
  .action(listCommand);

// Init command
program
  .command("init")
  .description("Initialize a new Chucky project in the current directory")
  .option("-y, --yes", "Skip prompts and use defaults")
  .action(initCommand);

// Deploy command
program
  .command("deploy")
  .description("Deploy workspace to Chucky")
  .option("-f, --folder <path>", "Folder to deploy (overrides config)")
  .option("--force", "Auto-commit uncommitted changes")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(deployCommand);

// Keys command
program
  .command("keys")
  .description("Show HMAC key for current project")
  .action(keysCommand);

// Config commands
const configCmd = program
  .command("config")
  .description("Configure project settings");

configCmd
  .command("anthropic")
  .description("Set Anthropic API key for current project")
  .option("-k, --key <key>", "Anthropic API key (sk-ant-...)")
  .action(configAnthropicCommand);

// Delete command
program
  .command("delete [projectId]")
  .description("Delete a project")
  .action(deleteCommand);

// Prompt command
program
  .command("prompt [prompt]")
  .description("Send a prompt to a Chucky project")
  .option("--project <name|id>", "Project to run against")
  .option("--token <jwt>", "Use a pre-generated JWT token")
  .option("--output-format <format>", "Output format: text, json, stream-json", "text")
  .option("--json-schema <schema>", "JSON Schema for structured output")
  .option("--model <model>", "Model: sonnet, opus, haiku, or full name")
  .option("--system-prompt <prompt>", 'System prompt (string or JSON: {"type":"preset","preset":"claude_code"})')
  .option("--tools <tools>", 'Tools config (JSON: {"type":"preset","preset":"claude_code"} or comma-separated names)')
  .option("--allowed-tools <tools>", "Comma-separated list of allowed tools")
  .option("--disallowed-tools <tools>", "Comma-separated list of disallowed tools")
  .option("--permission-mode <mode>", "Permission mode (bypassPermissions, default, etc.)")
  .option("--dangerously-skip-permissions", "Bypass all permission checks")
  .option("--max-turns <n>", "Maximum conversation turns", parseInt)
  .option("--max-budget-usd <amount>", "Maximum spend limit", parseFloat)
  .option("--mcp-config <json>", "MCP servers configuration (JSON)")
  .option("--agents <json>", "Custom agents definition (JSON)")
  .option("--betas <betas>", "Beta headers (comma-separated)")
  .option("--allow-possession", "Enable host tools - Claude can execute commands on your machine")
  .option("--apply", "Auto-apply file changes to local workspace after session completes")
  .action(promptCommand);

// Jobs command
program.addCommand(createJobsCommand());

// Sessions command
program
  .command("sessions")
  .description("List sessions")
  .option("-n, --limit <number>", "Number of sessions to show", "20")
  .option("--with-bundle", "Only show sessions with bundles")
  .option("--json", "Output as JSON")
  .action((options) => sessionsCommand({
    limit: parseInt(options.limit),
    withBundle: options.withBundle,
    json: options.json,
  }));

// Fetch command - download job/session results to temp branch
program
  .command("fetch <id>")
  .description("Download job/session bundle to temp branch (auto-detects type by ID prefix)")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(fetchCommand);

// Diff command - show what agent changed
program
  .command("diff <id>")
  .description("Show what agent changed (auto-detects job/session by ID prefix)")
  .option("--json", "Output as JSON")
  .option("--stat", "Show file stats only")
  .action(diffCommand);

// Log command - show agent's commits
program
  .command("log <id>")
  .description("Show agent's commits (auto-detects job/session by ID prefix)")
  .option("--json", "Output as JSON")
  .action(logCommand);

// Apply command - merge agent changes to current branch
program
  .command("apply <id>")
  .description("Merge agent changes to current branch (auto-detects job/session by ID prefix)")
  .option("--force", "Force merge even if not fast-forward")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(applyCommand);

// Discard command - delete agent's temp branch
program
  .command("discard <id>")
  .description("Delete agent's temp branch (auto-detects job/session by ID prefix)")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(discardCommand);

// Wait command - wait for job to complete
program
  .command("wait <job-id>")
  .description("Wait for job to complete")
  .option("--timeout <seconds>", "Max wait time in seconds", "300")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(waitCommand);

// Pull command - fetch and apply results
program
  .command("pull <id>")
  .description("Fetch and apply results (auto-detects job/session by ID prefix)")
  .option("--force", "Force apply")
  .option("--json", "Output as JSON")
  .option("--quiet", "No output, just exit code")
  .action(pullCommand);

// Parse arguments
program.parse();
