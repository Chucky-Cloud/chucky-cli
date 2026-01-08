import { confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { requireApiKey, loadProjectConfig } from "../lib/config.js";
import { ChuckyApi, type Project } from "../lib/api.js";

export async function deleteCommand(projectIdArg?: string): Promise<void> {
  console.log(chalk.bold("\nDelete Project\n"));

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);

    let projectId = projectIdArg;
    let projectName: string | undefined;

    // If no project ID provided, try current project or ask
    if (!projectId) {
      const projectConfig = loadProjectConfig();

      if (projectConfig && projectConfig.projectId) {
        // Use current project
        const useCurrent = await confirm({
          message: `Delete current project '${projectConfig.name}'?`,
          default: false,
        });

        if (useCurrent) {
          projectId = projectConfig.projectId;
          projectName = projectConfig.name;
        }
      }

      // If still no project ID, let user select from list
      if (!projectId) {
        const spinner = ora("Fetching projects...").start();
        const projects = await api.listProjects();
        spinner.stop();

        if (projects.length === 0) {
          console.log(chalk.yellow("\nNo projects found."));
          return;
        }

        const selected = await select<Project>({
          message: "Select project to delete:",
          choices: projects.map((p) => ({
            name: `${p.name} (${p.id})`,
            value: p,
          })),
        });

        projectId = selected.id;
        projectName = selected.name;
      }
    }

    // Final confirmation
    const confirmDelete = await confirm({
      message: chalk.red(
        `Are you sure you want to delete '${projectName || projectId}'? This cannot be undone.`
      ),
      default: false,
    });

    if (!confirmDelete) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    const spinner = ora("Deleting project...").start();
    await api.deleteProject(projectId);
    spinner.succeed(`Project '${projectName || projectId}' deleted`);

    console.log(
      chalk.dim(
        "\nNote: If this was your current project, run 'chucky init' to initialize a new one."
      )
    );
  } catch (error) {
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}
