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

### Custom UI Elements

Most input components have been intentionally designed to be theme-aware by default, inheriting VS Code's global design tokens to stay in sync with the user's selected theme. This includes buttons (which can be styled using our `secondary-button` and `icon-button` classes), anchor tags, `<option>` elements, and common input types like `radio`, `checkbox`, and `text`.

To keep things consistent while avoiding unnecessary dependencies, we also include a small set of custom components:

- `<CustomDropdown>` and `<CustomDropdownOption>` provide a theme-integrated dropdown experience.
- `<ProgressRing>` is a simple, consistent loading indicator that fits right in with VS Code’s UI.

These components help us maintain a clean, unified look without relying on external UI libraries — and give us more control over the details when we need it.



## Building for release

The process for this is unaffected by the webview setup. The `npm run webpack` and `vsce package` commands will ensure the `webpack-ui` project is built and bundled.
