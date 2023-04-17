# Webview Contract Code

This folder contains code that's shared between the VS Code extension and the `webview-ui` project.

The intent is to provide a single source of truth for the data types that both parties need to communicate.

This includes:
- Unique view identifiers
- Initial state
- Command message types
- Other types that make up components of Webviews
- Message subscription logic

Types that are specific to individual Webviews are in `webviewTypes.ts`.