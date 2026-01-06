import chalk from "chalk";
import ora from "ora";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
export async function keysCommand() {
    const spinner = ora("Fetching HMAC key...").start();
    try {
        const apiKey = requireApiKey();
        const projectConfig = requireProjectConfig();
        const api = new ChuckyApi(apiKey);
        const keyInfo = await api.getHmacKey(projectConfig.projectId);
        spinner.stop();
        console.log(chalk.bold(`\nHMAC Key for ${projectConfig.projectName}\n`));
        console.log(chalk.dim("Use this key to sign JWTs for your users.\n"));
        console.log(`  ${chalk.bold("Key:")} ${keyInfo.hmacKey}`);
        console.log(`  ${chalk.bold("Created:")} ${new Date(keyInfo.createdAt).toLocaleString()}`);
        console.log();
        console.log(chalk.dim("Tip: Keep this key secret. You can regenerate it in the dashboard if compromised."));
    }
    catch (error) {
        spinner.fail("Failed to fetch HMAC key");
        console.log(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
    }
}
//# sourceMappingURL=keys.js.map