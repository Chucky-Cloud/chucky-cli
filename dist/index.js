#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { listCommand } from "./commands/list.js";
import { initCommand } from "./commands/init.js";
import { deployCommand } from "./commands/deploy.js";
import { keysCommand } from "./commands/keys.js";
import { configAnthropicCommand } from "./commands/config.js";
import { deleteCommand } from "./commands/delete.js";
const program = new Command();
program
    .name("chucky")
    .description("CLI for deploying workspaces to Chucky cloud")
    .version("0.1.0");
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
// Parse arguments
program.parse();
//# sourceMappingURL=index.js.map