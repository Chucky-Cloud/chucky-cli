import { password } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";

export async function configAnthropicCommand(options: { key?: string }): Promise<void> {
  console.log(chalk.bold("\nSet Anthropic API Key\n"));

  try {
    const apiKey = requireApiKey();
    const projectConfig = requireProjectConfig();
    const api = new ChuckyApi(apiKey);

    // Get Anthropic API key from option or prompt
    let anthropicKey = options.key;

    if (!anthropicKey) {
      anthropicKey = await password({
        message: "Anthropic API key (sk-ant-...):",
        mask: "*",
        validate: (value) => {
          if (!value) return "API key is required";
          if (!value.startsWith("sk-ant-")) {
            return "Anthropic API key should start with 'sk-ant-'";
          }
          return true;
        },
      });
    }

    // Validate format
    if (!anthropicKey.startsWith("sk-ant-")) {
      console.log(
        chalk.red("\nError: Anthropic API key should start with 'sk-ant-'")
      );
      process.exit(1);
    }

    const spinner = ora("Updating Anthropic API key...").start();

    await api.setAnthropicKey(projectConfig.projectId, anthropicKey);

    spinner.succeed("Anthropic API key updated");
    console.log(chalk.dim(`\nProject: ${projectConfig.projectName}`));
  } catch (error) {
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}
