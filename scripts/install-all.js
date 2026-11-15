const { spawnSync } = require("node:child_process");
const path = require("node:path");

// npm exports user config to lifecycle scripts, but nested project installs reject this setting as a CLI override.
const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "npm_config_allow_scripts"),
);
const npmCli = process.env.npm_execpath;

for (const cwd of [path.resolve(__dirname, ".."), path.resolve(__dirname, "../webview-ui")]) {
    const result = spawnSync(process.execPath, [npmCli, "install", "--legacy-peer-deps"], {
        cwd,
        env,
        stdio: "inherit",
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
