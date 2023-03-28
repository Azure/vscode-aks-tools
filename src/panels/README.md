# `panels` Directory

This is adapted from the [Webview UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit) [guide](https://github.com/microsoft/vscode-webview-ui-toolkit/blob/main/docs/getting-started.md) for developing Webviews.

See also:
- [Samples](https://github.com/microsoft/vscode-webview-ui-toolkit-samples)
- The [React sample](https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-vite)

This directory contains all of the webview-related code that will be executed within the extension context. It can be thought of as the place where all of the "backend" code of a webview panel is contained.

A `Panel` is a TypeScript class which manages the state and behaviour of a Webview panel, and handles:
- Creating and rendering the webview panel
- Properly cleaning up and disposing of webview resources when the panel is closed
- Setting message listeners so data can be passed between the webview and extension
- Setting the HTML (and by proxy CSS/JavaScript) content of the webview panel

Each Webview (corresponding to its own extension command) extends the `BasePanel` class to configure its own initial state and message passing.
