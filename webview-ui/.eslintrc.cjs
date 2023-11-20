module.exports = {
    env: {
        browser: true,
        es2020: true
    },
    ignorePatterns: ["*.js", "*.cjs"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended"
    ],
    rules: {
        "@typescript-eslint/no-unused-vars": ["error", { "ignoreRestSiblings": true }]
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        project: "./tsconfig.json",
        sourceType: "module",
        ecmaFeatures: {
            jsx: true
        }
    },
    plugins: ["@typescript-eslint"],
    root: true,
    settings: {
        react: {
            version: "detect"
        }
    }
};