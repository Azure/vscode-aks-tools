import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: [
            "**/.github/",
            "**/.vscode-test/",
            "**/node_modules/",
            "**/dist/",
            "**/docs/",
            "**/out/",
            "**/publish-book/",
            "**/resources",
            "**/webview-ui/",
            "**/*.js",
            "**/*.mjs",
        ],
    },
    ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.mocha,
            },

            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: "module",

            parserOptions: {
                project: "./tsconfig.json",
            },
        },

        rules: {
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: "variable",
                    format: ["camelCase", "UPPER_CASE"],
                    leadingUnderscore: "forbid",
                    trailingUnderscore: "forbid",
                },
            ],

            "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",

            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    ignoreRestSiblings: true,
                    argsIgnorePattern: "^_",
                },
            ],

            "@typescript-eslint/prefer-for-of": "error",
            curly: ["error", "multi-line"],
            eqeqeq: ["error", "always"],

            "id-denylist": [
                "error",
                "any",
                "Number",
                "number",
                "String",
                "string",
                "Boolean",
                "boolean",
                "Undefined",
                "undefined",
            ],

            "no-underscore-dangle": "error",

            // Matches the call, not just a template-literal argument: `const command = ...;
            // exec(command)` is the usual style here. Member calls like regex.exec() are unaffected.
            "no-restricted-syntax": [
                "error",
                {
                    selector: 'CallExpression[callee.name="exec"]',
                    message:
                        "Do not build shell command strings from values. Use execFile(binary, argsArray); see docs/book/src/development/development.md.",
                },
                {
                    // The string form reaches a shell via the kubernetes-tools dependency.
                    selector: 'CallExpression[callee.name="invokeKubectlCommand"]',
                    message:
                        "Do not build kubectl command strings. Use invokeKubectlCommandArgs(kubectl, kubeConfigFile, argsArray); see docs/book/src/development/development.md.",
                },
            ],
            "no-var": "error",
            "prefer-const": "error",
            "prefer-template": "error",
        },
    },
];
