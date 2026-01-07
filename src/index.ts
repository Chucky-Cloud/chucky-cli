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

const program = new Command();

program
  .name("chucky")
  .description("CLI for deploying workspaces to Chucky cloud")
  .version("0.2.4");

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
  .action(promptCommand);

// Parse arguments
program.parse();
