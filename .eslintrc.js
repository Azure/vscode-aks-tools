module.exports = {
    env: {
        es2020: true,
        node: true,
        mocha: true,
    },
    ignorePatterns: [
        ".github/",
        ".vscode-test/",
        "node_modules/",
        "dist/",
        "docs/",
        "out/",
        "publish-book/",
        "resources",
        "webview-ui/",
        "*.js",
    ],
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2020,
        project: "./tsconfig.json",
        sourceType: "module",
    },
    plugins: ["@typescript-eslint"],
    root: true,
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
        "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
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
};
