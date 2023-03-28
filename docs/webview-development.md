# Webview Development

For commands that require a webview (see [guidance](https://code.visualstudio.com/api/extension-guides/webview#should-i-use-a-webview) on where this is appropriate), the [`webview-ui`](../webview-ui/) project provides the necessary tooling to develop the front end.

## Initial Setup

Run `npm run install:all` to install package dependencies for both the extension and webview project.

## Development/Debugging

### Developing the UI

- Run `npm run dev:webview` to start the development server.
- Either:
  - open `http://localhost:3000` in a browser (if you prefer to use your browser development tools for debugging), or
  - hit `F5` to launch the `Webview UI` debug profile in VS Code (if you prefer to debug in VS Code)

### Developing the VS Code commands that launch the UI

- Run `npm run build:webview` to publish minified resources to the `dist` folder in the `webview-ui` project.
- Hit `F5` to launch the `Extension` debug profile in a new VS Code Window.

## Building for release

This is unchanged. The `npm run webpack` command will ensure the `webpack-ui` project is built and bundled.
