# Webview Development

For commands that require a webview (see [guidance](https://code.visualstudio.com/api/extension-guides/webview#should-i-use-a-webview) on where this is appropriate), the [`webview-ui`](../webview-ui/) project provides the necessary tooling to develop the front end.

## Initial Setup

Run `npm run install:all` to install package dependencies for both the extension and webview project.

## Development/Debugging

### File structure

- Webview source files are under `/webview-ui/src`.
- When built, bundled/minified webview assets are output to `/webview-ui/dist`.

When the extension is run (both in development and production), the webview assets are read from `/webview-ui/dist`.

### Developing the UI

If you like to use your browser development tools for debugging, or you wish to open the web application in an existing browser window:
1. Run `npm run dev:webview` to start the development server.
2. Navigate to `http://localhost:3000` in your browser.

Alternatively, if you are developing in VS Code and wish to use the inbuilt debugging functionality:
1. Hit `F5` to launch the `Webview UI` debug profile in a new browser window. This will automatically run the development server and attach a debugger.

### Developing the VS Code commands that launch the UI

To debug the extension itself, hit `F5` to launch the `Extension` debug profile in a new VS Code Window. This will automatically build, bundle and minify both the `webview-ui` project and the extension.

The extension will not automatically update itself in response to code changes as you are debugging, so the best workflow here is to stop debugging, make changes, and launch the debugger again.

## Building for release

The process for this is unaffected by the webview setup. The `npm run webpack` and `vsce package` commands will ensure the `webpack-ui` project is built and bundled.
