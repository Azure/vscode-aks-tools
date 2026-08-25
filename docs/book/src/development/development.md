# Package Scripts

This gives an overview of the `npm` scripts available for development and release of the extension. See the `scripts` block in [package.json](../../../../package.json).

These can all be run from the command line in the root of the repository (with `npm` installed), using `npm run {script-name}`.

## Environment Initialization

- `install:all`: Installs `npm` dependencies for both the main extension project and the `webview-ui` sub-project. It's recommended to use this instead of `npm install`, which will only install dependencies for the main project.

## Development and Testing

- [`dev:webview`](./webview-development.md#developing-the-ui): for concurrent development/debugging of webview UX.
- `build:webview`: bundles and minifies the webview UX for consumption by the extension.
- `webpack`: builds and packages the extension.
- `test`: runs automated tests.
- `test:scripts`: runs the unit tests for the `scripts/` tooling. Plain node and mocha, so no compile step.

## Documentation

These validate this book against what `package.json` actually contributes, so command IDs, setting names and menu paths in prose cannot drift from the extension.

- `docs:check`: runs all documentation checks. Pass names to run a subset, for example `npm run docs:check menu-paths`.
    - `identifiers`: flags an `aks.*` or `azure.*` identifier in prose that `package.json` does not contribute. Fenced code blocks are skipped, so a sample quoting another extension's settings is not an error.
    - `menu-paths`: flags a menu breadcrumb that does not match the real menu.
    - `menu-syntax`: flags menu navigation written as prose instead of `**A** > **B**`. See below.
    - `coverage`: warns about a command documented nowhere in prose.
    - `orphans`: warns about an image no page references.
- `docs:reference`: regenerates the reference pages under `src/reference/`. These carry a `DO NOT EDIT` header — change the generator or `package.json`, not the output.
- `docs:reference:check`: fails if those pages are stale. Run `docs:reference` and commit the result.

Links, images, anchors and `SUMMARY.md` completeness are deliberately **not** checked here. `lychee --offline --include-fragments` covers the first three and handles raw HTML and URL fragments properly, and `mdbook build` with `create-missing = false` fails on a `SUMMARY.md` entry with no page.

### Writing menu navigation

Write navigation with `>` between the steps, and bold each one:

```markdown
Right-click your AKS cluster > **Troubleshoot & Diagnose** > **Troubleshoot Network Health** > **Collect TCP Dumps**
```

Not as prose:

```markdown
Right-click your AKS cluster and select **Troubleshoot & Diagnose** and then
click on **Collect TCP Dumps**
```

`menu-paths` only recognises the first form, so an instruction written the second way is skipped rather than validated — the page can go stale and nothing reports it. `menu-syntax` exists to make that a visible error instead of silence.

The convention is not only for the tooling. `>` states where the menu ends, which prose cannot: "click **Create Cluster** and select **Create Standard Cluster**" reads as two menu levels, but the second is a button in the wizard the first opens. Writing the menu part with `>` and leaving the rest as prose keeps that boundary clear for readers too.

If a line mentions right-click without giving an instruction — naming the context menu, say — put this marker on the page:

```markdown
<!-- docs-check: not-a-menu -->
```

### Documenting the classic menu

The menu layout depends on the `aks.simplifiedMenuStructure` setting, which defaults to `true`. `menu-paths` validates breadcrumbs against that default.

A page that deliberately documents the classic layout (the setting turned off) opts out by including this marker anywhere in the file, usually in an HTML comment:

```markdown
<!-- docs-check: classic-menu -->
```

Breadcrumbs on that page are then accepted if they match either menu. Use it only for pages genuinely about the classic layout — a breadcrumb that is simply out of date should be fixed, not marked.

## Not for Running Directly

Some scripts are invoked by other scripts or tools, so need not be run directly, or are otherwise not required for general development tasks:

- `vscode:prepublish`: used by the `vsce` command for packaging the extension into a `vsix` file for distribution.
- `webpack-dev`: builds the `webview-ui` project and then bundles the extension code in development mode (`--watch`). This is the `preLaunchTask` for the `Extension` debug profile (F5).
- `test-compile`: compiles the extension typescript (after building the `webview-ui` project) without webpacking it. This is a prerequisite to running automated tests. It _could_ be moved into `test`, but keeping it separate would allow it to be used in the future as a prelaunch task for debugging the extension without webpacking it.
- `watch`: not currently used as part of any workflow I'm aware of, but could potentially be useful for editing while debugging.

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
   vsce package
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