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

```sh
npm run lint:all          # lint step in the Build workflow
npm test                  # Build workflow
npm run test:fuzz         # Fuzzing Tests workflow
npm run prettier-format   # Prettier Check workflow
```

The first three run on every pull request and will fail it. **Prettier Check** only
runs when the pull request touches a `.ts` or `.tsx` file, but when it does run it
checks `.json`, `.css` and `.md` too, so format everything before pushing rather
than only what triggered it.

Pull requests are capped at **1200 changed lines** by the PR Size Checker workflow.
Prefer splitting the work. If a larger change is genuinely unavoidable, include
`[skip pr-size]` in the most recent commit message.

A husky pre-commit hook runs Prettier over staged files. It is installed automatically
by `npm install` via the `prepare` script.

## Documentation

User-facing documentation lives in `docs/book/` and is published to
[azure.github.io/vscode-aks-tools](https://azure.github.io/vscode-aks-tools). Only
`docs/book/**` is published, so that is the copy to edit.

Pages under `docs/book/src/reference/` are generated from `package.json` and carry a
`DO NOT EDIT` header. Regenerate them rather than editing by hand:

```sh
npm run docs:reference    # regenerate
npm run docs:check        # command IDs, command names and menu paths in prose
```

Neither runs in CI yet, so run them yourself when you change `package.json` or the
book.
