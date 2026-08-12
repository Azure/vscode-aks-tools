# Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Getting set up

Node.js 22 is what CI builds with. Install dependencies for both the extension and the
`webview-ui` sub-project:

```sh
npm run install:all
```

Press <kbd>F5</kbd> to launch the extension in a development host. See
[Development](https://azure.github.io/vscode-aks-tools/development/development.html)
for the full script reference and
[Webview Development](https://azure.github.io/vscode-aks-tools/development/webview-development.html)
for working on the UI.

## Before you open a pull request

Each of these has a CI job that will fail the PR if skipped:

```sh
npm run prettier-format   # Prettier Check workflow
npm run lint:all          # lint step in the Build workflow
npm test                  # Build workflow
```

Pull requests are capped at **1200 changed lines** by the PR Size Checker workflow.
Prefer splitting the work. If a larger change is genuinely unavoidable, include
`[skip pr-size]` in the commit message.

A husky pre-commit hook runs Prettier over staged files. It is installed automatically
by `npm install` via the `prepare` script.

## Documentation

User-facing documentation lives in `docs/book/` and is published to
[azure.github.io/vscode-aks-tools](https://azure.github.io/vscode-aks-tools). Only
`docs/book/**` is published, so that is the copy to edit.

Pages under `docs/book/src/reference/` are generated from `package.json` and carry a
`DO NOT EDIT` header. Regenerate them rather than editing by hand:

```sh
node scripts/generate-docs-reference.js
node scripts/docs-check.js
```
