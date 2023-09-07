# Webview Contract Code

This folder contains code that's shared between the VS Code extension and the `webview-ui` project.

The intent is to provide a single source of truth for the data types that both parties need to communicate.

This includes:
- Unique Webview identifiers (content IDs)
- Initial state
- Command message types
- Other types that make up components of Webviews
- Message subscription logic

Types that are specific to individual Webviews are in the `webviewDefinitions` directory. Each of these
exports a `WebviewDefinition` type that combines the common types for each Webview.

Each Webview's types are associated with a `ContentId` key in `AllWebviewDefinitions`, spefified in `webviewTypes.ts`.