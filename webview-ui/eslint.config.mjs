import { fixupConfigRules, fixupPluginRules } from "@eslint/compat";
import eslintReact from "@eslint-react/eslint-plugin";
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
        ignores: ["**/node_modules/", "**/dist/", "**/*.js", "**/*.cjs"],
    },
    ...fixupConfigRules(
        compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react-hooks/recommended"),
    ),
    {
        files: ["**/*.{ts,tsx}"],
        plugins: { "@eslint-react": eslintReact },
        // Map the previous React checks; migration gaps are documented in webview-development.md.
        rules: {
            "@eslint-react/no-missing-component-display-name": "error",
            "@eslint-react/no-missing-context-display-name": "error",
            "@eslint-react/no-missing-key": "error",
            "@eslint-react/dom-no-unsafe-target-blank": "error",
            "@eslint-react/dom-no-unknown-property": "error",
            "@eslint-react/jsx-no-comment-textnodes": "error",
            "@eslint-react/jsx-no-children-prop": "error",
            "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
            "@eslint-react/no-direct-mutation-state": "error",
            "@eslint-react/no-component-will-mount": "error",
            "@eslint-react/no-component-will-receive-props": "error",
            "@eslint-react/no-component-will-update": "error",
            "@eslint-react/dom-no-find-dom-node": "error",
            "@eslint-react/dom-no-render": "error",
            "@eslint-react/dom-no-hydrate": "error",
            "@eslint-react/dom-no-render-return-value": "error",
        },
    },
    {
        plugins: {
            "@typescript-eslint": fixupPluginRules(typescriptEslint),
        },

        languageOptions: {
            globals: {
                ...globals.browser,
            },

            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: "module",

            parserOptions: {
                project: ["./tsconfig.json", "./tsconfig.node.json"],

                ecmaFeatures: {
                    jsx: true,
                },
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
            "no-var": "error",
            "prefer-const": "error",
            "prefer-template": "error",
        },
    },
];
