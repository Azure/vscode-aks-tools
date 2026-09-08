# Webview Development

For commands that require a webview (see [guidance](https://code.visualstudio.com/api/extension-guides/webview#should-i-use-a-webview) on where this is appropriate), the [`webview-ui`](../../../../webview-ui/) project provides the necessary tooling to develop the front end.

## Initial Setup

Run `npm run install:all` to install package dependencies for both the extension and webview project.

### Linting

Use Node.js 22 or newer. Run `npm run lint:all` from the repository root and
`npm run test:lint --prefix webview-ui` for the lint configuration regression tests.

The webview uses `@eslint-react/eslint-plugin` with ESLint 10 instead of
`eslint-plugin-react`, whose published peer dependency range does not support ESLint 10.
Both projects install with normal npm peer validation; no package downgrade or peer override is needed.

The React configuration explicitly maps the previous recommended checks rather than enabling
the replacement plugin's broader recommended preset. `eslint-plugin-react-hooks` remains
responsible for Hooks checks, preserving existing rule names and suppression comments.

This migration is not exact rule parity:

- Missing keys, JSX comment text, children props, unsafe target links, unknown DOM properties,
  state mutation, conflicting inner HTML/children, and deprecated lifecycle/DOM API checks remain enabled.
- Display-name checks cover anonymous wrapped components and now also contexts, rather than all
  component forms checked by the old plugin.
- TypeScript and React 19 types cover duplicate explicit JSX attributes, unresolved JSX names,
  typed props, string refs, removed `isMounted` calls, and missing class render returns. These checks
  require the TypeScript build, not just lint, and cannot protect untyped `any` usage.
- The old `react/no-unescaped-entities` check has no equivalent in the replacement plugin and is
  no longer enforced. TypeScript does not cover valid JSX text containing unescaped quotes/apostrophes.

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

> **Prerequisite:** Run `npm run install:all` at least once before debugging (see [Initial Setup](#initial-setup)). A plain `npm install` does **not** install the `webview-ui` dependencies, so the webview build produces no assets and panels render blank.

To debug the extension itself, hit `F5` to launch the `Extension` debug profile in a new VS Code Window. This will automatically build the `webview-ui` project (via `npm run build:webview`) and bundle the extension, so the assets in `/webview-ui/dist` are always present.

The extension will not automatically update itself in response to code changes as you are debugging, so the best workflow here is to stop debugging, make changes, and launch the debugger again.

### Custom UI Elements

Most input components have been intentionally designed to be theme-aware by default, inheriting VS Code's global design tokens to stay in sync with the user's selected theme. This includes buttons (which can be styled using our `secondary-button` and `icon-button` classes), anchor tags, `<option>` elements, and common input types like `radio`, `checkbox`, and `text`.

To keep things consistent while avoiding unnecessary dependencies, we also include a small set of custom components:

- `<CustomDropdown>` and `<CustomDropdownOption>` provide a theme-integrated dropdown experience.
- `<ProgressRing>` is a simple, consistent loading indicator that fits right in with VS Code’s UI.

These components help us maintain a clean, unified look without relying on external UI libraries — and give us more control over the details when we need it.



## Building for release

The process for this is unaffected by the webview setup. The `npm run webpack` and `vsce package` commands will ensure the `webview-ui` project is built and bundled.
