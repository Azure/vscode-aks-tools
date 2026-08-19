# Package Scripts

This gives an overview of the `npm` scripts available for development and release of the extension. See the `scripts` block in [package.json](../../../../package.json).

These can all be run from the command line in the root of the repository (with `npm` installed), using `npm run {script-name}`.

## Prerequisites

- **Node.js 22.** This is the version CI builds and packages with. There is no
  `engines.node` constraint or `.nvmrc`, so nothing enforces it locally.
- VS Code `^1.110.0`, per `engines.vscode`.

## Environment Initialization

- `install:all`: Installs `npm` dependencies for both the main extension project and the `webview-ui` sub-project. It's recommended to use this instead of `npm install`, which will only install dependencies for the main project. Note that both installs pass `--legacy-peer-deps`; a bare `npm install` will fail on peer dependency resolution.
- `prepare`: installs the husky git hooks. Runs automatically after `npm install`.

## Development and Testing

- [`dev:webview`](./webview-development.md#developing-the-ui): for concurrent development/debugging of webview UX.
- `build:webview`: bundles and minifies the webview UX for consumption by the extension.
- `webpack`: builds the webview UX and then bundles the extension in production mode. This does not produce a `vsix`; use `package` for that.
- `package`: packages the extension into a `vsix` (`vsce package --no-dependencies`).
- `test`: runs automated tests.
- `test:fuzz`: runs the fuzzing test suite.

## Checks that gate a pull request

Run these before pushing; each has a corresponding CI job that will fail the PR.

- `prettier-format`: formats the repository with Prettier. The **Prettier Check** workflow fails if anything is unformatted.
- `lint:all`: lints both the extension and `webview-ui`. The **Build** workflow runs a lint step.
- `lint-fix:all`: the same, applying autofixes.

Pull requests are also limited to **1200 changed lines** by the **PR Size Checker** workflow. Include `[skip pr-size]` in the commit message only when a larger change is genuinely unavoidable.

## Not for Running Directly

Some scripts are invoked by other scripts or tools, so need not be run directly, or are otherwise not required for general development tasks:

- `vscode:prepublish`: used by the `vsce` command for packaging the extension into a `vsix` file for distribution.
- `webpack-dev`: builds the `webview-ui` project and then bundles the extension code in development mode (`--watch`). This is the `preLaunchTask` for the `Extension` debug profile (F5).
- `test-compile`: compiles the extension typescript (after building the `webview-ui` project) without webpacking it, then copies `resources/yaml/aks-deploy.template.yaml` next to the compiled output. This is a prerequisite to running automated tests.
- `lint`: lints the extension only. `lint:all` is usually what you want.
- `eslint-inspector`: opens the ESLint config inspector for debugging lint rules.
- `watch`: not used by any current workflow, but can be useful for editing while debugging.

### **Local VSIX Sharing and How to Share via a GitHub Comment**

Follow these steps to modify the `package.json` version, generate a VSIX file, and prepare it for sharing as a renamed file in a GitHub comment:

### **Step 1: Update the `package.json` Version**
1. Open the **`package.json`** file in your project directory.
2. Find the `"version"` field.
3. Update it to a unique test version (e.g., `1.0.0-test.1` or include a timestamp for uniqueness).  
   Example:
   ```json
   {
     "name": "my-extension",
     "version": "1.0.0-test.1",
     "main": "extension.js"
   }
   ```
4. Save your changes.

### **Step 2: Generate the VSIX File**
1. Open a terminal in your project directory.
2. Run the following command to package the extension: ([How to install `vsce`](https://www.npmjs.com/package/@vscode/vsce))
   ```bash
   npm run package
   ```
3. A file like `my-extension-1.0.0-test.1.vsix` will be created in your project directory.

### **Step 3: Rename the File for Sharing**
1. **Rename the VSIX File:**
   GitHub does not allow direct upload of files with the `.vsix` extension. To work around this:
   - Rename the file by appending `.zip` to the original name.  
     Example:  
     Rename `filename.vsix` to `filename.vsix.zip`.

2. **Upload to GitHub:**
   - Drag and drop the renamed file (`filename.vsix.zip`) into your GitHub comment or PR description. 

### **Final Notes**
- This renaming approach avoids additional steps like zipping or compressing the file.
- The development team is typically familiar with this process, making it a quick and effective way to share test versions.

Happy coding! 🚀