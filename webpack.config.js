"use strict";

const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const ESLintPlugin = require("eslint-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

class CleanSkillsPlugin {
    apply(compiler) {
        const skillsDir = path.resolve(compiler.options.output.path, "skills");
        const clean = () => {
            fs.rmSync(skillsDir, { recursive: true, force: true });
        };
        compiler.hooks.beforeRun.tap("CleanSkillsPlugin", clean);
        compiler.hooks.watchRun.tap("CleanSkillsPlugin", clean);
    }
}

/**@type {import('webpack').Configuration}*/
const config = {
    target: "node",
    entry: "./src/extension.ts",
    optimization: {
        minimize: false,
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "extension.js",
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    devtool: "source-map",
    externals: {
        vscode: "commonjs vscode",
        bufferutil: "commonjs bufferutil",
        "spawn-sync": "commonjs spawn-sync",
        "utf-8-validate": "commonjs utf-8-validate",
        "applicationinsights-native-metrics": "applicationinsights-native-metrics",
        "@opentelemetry/tracing": "@opentelemetry/tracing",
        "cpu-features": "commonjs cpu-features",
    },
    plugins: [
        new CleanSkillsPlugin(),
        new ESLintPlugin({
            extensions: ["ts"],
            exclude: ["node_modules", "webview-ui"],
        }),
        // Prevent webpack from trying to bundle electron, or require it as a direct dependency:
        // https://github.com/sindresorhus/got/issues/345#issuecomment-329939488
        new webpack.IgnorePlugin({ resourceRegExp: /^electron$/ }),
        // Copy workflow template file to dist
        new CopyPlugin({
            patterns: [
                {
                    from: "resources/yaml/aks-deploy.template.yaml",
                    to: "[name][ext]",
                },
                {
                    from: "node_modules/containerization-assist-mcp/skills",
                    to: "skills",
                    noErrorOnMissing: true,
                },
            ],
        }),
    ],
    resolve: {
        extensions: [".ts", ".js", ".json"],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "ts-loader",
                    },
                ],
            },
            {
                test: /\.node$/,
                loader: "node-loader",
            },
        ],
    },
    node: {
        __dirname: false,
        __filename: false,
    },
};
module.exports = config;
