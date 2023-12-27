module.exports = {
    env: {
        browser: true,
        es2020: true,
    },
    ignorePatterns: ["node_modules/", "dist/", "*.js", "*.cjs"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2020,
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        sourceType: "module",
        ecmaFeatures: {
            jsx: true,
        },
    },
    plugins: ["@typescript-eslint"],
    root: true,
    settings: {
        react: {
            version: "detect",
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
