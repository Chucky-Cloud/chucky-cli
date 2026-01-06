import chalk from "chalk";
import ora from "ora";
import { requireApiKey } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
export async function listCommand() {
    const spinner = ora("Fetching projects...").start();
    try {
        const apiKey = requireApiKey();
        const api = new ChuckyApi(apiKey);
        const projects = await api.listProjects();
        spinner.stop();
        if (projects.length === 0) {
            console.log(chalk.yellow("\nNo projects found."));
            console.log(chalk.dim("Run 'chucky init' to create a new project."));
            return;
        }
        console.log(chalk.bold(`\nProjects (${projects.length}):\n`));
        for (const project of projects) {
            const status = project.isActive
                ? chalk.green("active")
                : chalk.red("inactive");
            console.log(`  ${chalk.bold(project.name)}`);
            console.log(`    ID: ${chalk.dim(project.id)}`);
            console.log(`    Status: ${status}`);
            console.log(`    HMAC Key: ${chalk.dim(project.hmacKey)}`);
            if (project.description) {
                console.log(`    Description: ${chalk.dim(project.description)}`);
            }
            console.log();
        }
    }
    catch (error) {
        spinner.fail("Failed to fetch projects");
        console.log(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
    }
}
//# sourceMappingURL=list.js.map