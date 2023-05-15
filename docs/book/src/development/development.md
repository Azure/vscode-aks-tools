# Package Scripts

This gives an overview of the `npm` scripts available for development and release of the extension. See the `scripts` block in [package.json](../package.json).

These can all be run from the command line in the root of the repository (with `npm` installed), using `npm run {script-name}`.

## Environment Initialization

- `install:all`: Installs `npm` dependencies for both the main extension project and the `webview-ui` sub-project. It's recommended to use this instead of `npm install`, which will only install dependencies for the main project.

## Development and Testing

- [`dev-webview`](./webview-development.md#developing-the-ui): for concurrent development/debugging of webview UX.
- `build-webview`: bundles and minifies the webview UX for consumption by the extension.
- `webpack`: builds and packages the extension.
- `test`: runs automated tests.

## Not for Running Directly

Some scripts are invoked by other scripts or tools, so need not be run directly, or are otherwise not required for general development tasks:

- `vscode:prepublish`: used by the `vsce` command for packaging the extension into a `vsix` file for distribution.
- `webpack-dev`: bundles the extension code in development mode. Since we currently have no conditional logic that depends on whether the extension is running in development or production, this may be redundant.
- `test-compile`: compiles the extension typescript (after building the `webview-ui` project) without webpacking it. This is a prerequisite to running automated tests. It _could_ be moved into `test`, but keeping it separate would allow it to be used in the future as a prelaunch task for debugging the extension without webpacking it.
- `watch`: not currently used as part of any workflow I'm aware of, but could potentially be useful for editing while debugging.
