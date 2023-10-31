/*
👋 Hi! This file was autogenerated by tslint-to-eslint-config.
https://github.com/typescript-eslint/tslint-to-eslint-config

It represents the closest reasonable ESLint configuration to this
project's original TSLint configuration.

We recommend eventually switching this configuration to extend from
the recommended rulesets in typescript-eslint. 
https://github.com/typescript-eslint/tslint-to-eslint-config/blob/master/docs/FAQs.md

Happy linting! 💖
*/
module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "eslint-plugin-prefer-arrow",
        "@typescript-eslint",
        "@typescript-eslint/tslint"
    ],
    "root": true,
    "rules": {
        "@typescript-eslint/member-delimiter-style": [
            "warn",
            {
                "multiline": {
                    "delimiter": "semi",
                    "requireLast": true
                },
                "singleline": {
                    "delimiter": "semi",
                    "requireLast": false
                }
            }
        ],
        "@typescript-eslint/naming-convention": [
            "warn",
            {
                "selector": "variable",
                "format": [
                    "camelCase",
                    "UPPER_CASE"
                ],
                "leadingUnderscore": "forbid",
                "trailingUnderscore": "forbid"
            }
        ],
        "@typescript-eslint/no-unnecessary-boolean-literal-compare": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/prefer-for-of": "warn",
        "@typescript-eslint/semi": [
            "warn",
            "always"
        ],
        "@typescript-eslint/type-annotation-spacing": "warn",
        "arrow-parens": [
            "warn",
            "always"
        ],
        "curly": [
            "warn",
            "multi-line"
        ],
        "eqeqeq": [
            "warn",
            "always"
        ],
        "id-denylist": [
            "warn",
            "any",
            "Number",
            "number",
            "String",
            "string",
            "Boolean",
            "boolean",
            "Undefined",
            "undefined"
        ],
        "id-match": "warn",
        "no-debugger": "warn",
        "no-multiple-empty-lines": "warn",
        "no-trailing-spaces": "warn",
        "no-underscore-dangle": "warn",
        "no-unused-vars": "off",
        "no-var": "warn",
        "prefer-arrow/prefer-arrow-functions": [
            "warn",
            {
                "allowStandaloneDeclarations": true
            }
        ],
        "prefer-const": "warn",
        "prefer-template": "warn",
        "quote-props": [
            "warn",
            "as-needed"
        ],
        "semi": "off",
        "spaced-comment": [
            "warn",
            "always",
            {
                "markers": [
                    "/"
                ]
            }
        ],
        "@typescript-eslint/tslint/config": [
            "error",
            {
                "rules": {
                    "skipLibCheck": true,
                    "switch-final-break": [
                        true,
                        "always"
                    ],
                    "whitespace": [
                        true,
                        "check-branch",
                        "check-decl",
                        "check-module",
                        "check-separator",
                        "check-type",
                        "check-preblock"
                    ]
                }
            }
        ]
    }
};
