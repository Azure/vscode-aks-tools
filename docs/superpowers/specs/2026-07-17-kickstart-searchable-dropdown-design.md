# Kickstart SearchableDropdown — Design

**Date:** 2026-07-17
**Branch:** `review/kickstart-dropdown-state`
**Scope:** Kickstart webviews only (KickstartCluster + KickstartGuidedSetup)

## Problem

The kickstart experience uses **two different, non-interchangeable dropdown components**, so
there is no single generalized dropdown with a consistent feature set:

| | `TextWithDropdown` | `CustomDropdown` |
|---|---|---|
| Style | Searchable combobox (text input + list) | `<select>`-style button + listbox |
| Kickstart usages | 6 (KickstartCluster) | 1 (KickstartGuidedSetup github repo) |
| Type-to-search | Live filtered list | Prefix type-ahead jump only (no filter) |
| Fuzzy matching | Yes (`fuzzyMatch`) | No (`startsWith`) |
| Arrow-key nav | Yes | Yes (+ wraparound, Home/End, scrollIntoView) |
| Enter to select | Yes | Yes (+ Space) |
| Escape / a11y | Escape only, minimal ARIA | Escape/Tab, full ARIA, drop-up positioning |

Each is better at different things: `TextWithDropdown` has superior search but weaker
keyboard/a11y; `CustomDropdown` has superior keyboard/a11y but inferior search (the github-repo
dropdown — the one most in need of fuzzy search — has none).

### Kickstart dropdown instances

| # | ID | File | Component today |
|---|---|---|---|
| 1 | subscription-dropdown | ClusterInput.tsx | TextWithDropdown |
| 2 | location-dropdown | ClusterInput.tsx | TextWithDropdown |
| 3 | resource-group-dropdown | ClusterInput.tsx | TextWithDropdown |
| 4 | existing-subscription-dropdown | ExistingClusterInput.tsx | TextWithDropdown |
| 5 | existing-cluster-dropdown | ExistingClusterInput.tsx | TextWithDropdown |
| 6 | connected-acr-dropdown | ExistingClusterInput.tsx | TextWithDropdown |
| 7 | github-repo-dropdown | GuidedSetupInput.tsx | CustomDropdown |

## Goal

Build ONE new generalized component, `SearchableDropdown`, that is best-of-both
(fuzzy search + full keyboard/a11y), and migrate all 7 kickstart dropdowns to it.

Out of scope: the 12 other (non-kickstart) usages of `TextWithDropdown`/`CustomDropdown` keep
their current components. The old components are NOT deleted.

## Decisions

- **Direction:** brand-new `SearchableDropdown` (not evolving either existing component).
- **Add-item feature dropped.** All 6 Azure dropdowns already pass `allowAddItem={false}`; github
  has no such concept. Simpler API, no `isNew`.
- **Generic items + `toLabel`.** Component is generic over item type `T`; callers supply
  `getValue` and optional `toLabel`. This moves the github label-composition logic out of JSX.

## API

```ts
export interface SearchableDropdownProps<T> {
    id?: string;
    className?: string;
    // Raw items of any type. Lazy<> preserved for async loading states.
    items: Lazy<T[]> | T[];
    selectedValue: string | null;
    onSelect: (value: string | null) => void;
    disabled?: boolean;
    placeholder?: string;

    // Derive stable identity (returned by onSelect) from an item.
    getValue: (item: T) => string;
    // Derive display + fuzzy-search text. Defaults to getValue.
    toLabel?: (item: T) => string;
}
```

Internally the component normalizes items once to `{ value: getValue(item), label: (toLabel ?? getValue)(item) }`.
All fuzzy matching, rendering, and arrow-nav operate on that normalized array.
`onSelect` returns the derived `value`; fuzzy search runs against `label`.

### Call-site shapes

- **Azure dropdowns (strings):** `items={locations}` (`string[]`), `getValue={s => s}`,
  `toLabel` omitted. Near-zero change from today.
- **GitHub repos (objects):** `items={githubRepos}`, `getValue={r => r.cloneUrl}`,
  `toLabel={r => \`${name}${r.private ? " • private" : ""}${r.description ? \` — ${r.description}\` : ""}\`}`.

## Behavior (best-of-both feature set)

Carried from `TextWithDropdown`:
- Live fuzzy-filtered list via `fuzzyMatch` (utilities/fuzzy.ts), sorted by score.
- Text input for search; type-to-filter.
- `Lazy<>` display modes: Loader (spinner) while loading; Dropdown when items present.
  (TextField-only fallback for empty/not-loaded is dropped along with add-item — an empty
  list simply shows no options.)

Carried from `CustomDropdown`:
- Arrow-key nav with wraparound.
- Home/End to jump to first/last.
- `scrollIntoView({ block: "nearest" })` on highlight change.
- Enter (and Space where appropriate) to select; Escape and Tab to close.
- Full ARIA: `role="combobox"`/`listbox`/`option`, `aria-expanded`, `aria-activedescendant`,
  `aria-selected`.
- Drop-up positioning when near the viewport bottom.

## State management

Unchanged pattern (already clean and consistent):
- Transient UI state (open / highlight index / search text) → local `useState` inside
  `SearchableDropdown`.
- Selected value → controlled via `selectedValue` + `onSelect`, held in parent
  `Validatable<T>` local state.
- Option data → existing `useStateManagement` reducer + VS Code `postMessage`. No React Context.

Call sites drop the `isNew` argument they currently ignore/handle for add-item.

## Files

New:
- `webview-ui/src/components/SearchableDropdown.tsx`
- `webview-ui/src/components/SearchableDropdown.module.css` (adapted from the two existing modules)

Modified (migrate to SearchableDropdown):
- `webview-ui/src/KickstartCluster/ClusterInput.tsx` (3 dropdowns)
- `webview-ui/src/KickstartCluster/ExistingClusterInput.tsx` (3 dropdowns)
- `webview-ui/src/KickstartGuidedSetup/GuidedSetupInput.tsx` (1 dropdown; remove
  `CustomDropdownOption` usage there)

Unchanged / not deleted:
- `TextWithDropdown.tsx`, `CustomDropdown.tsx`, `CustomDropdownOption.tsx` (still used by 12
  non-kickstart call sites).
- `utilities/fuzzy.ts` (reused as-is).

## Testing

- Manual: each of the 7 dropdowns — type-to-search, fuzzy ranking, ArrowUp/Down (+ wraparound),
  Home/End, Enter/Escape, drop-up near viewport bottom, loading spinner (subscriptions), disabled
  state.
- Regression: confirm the 12 non-kickstart dropdowns are untouched.
- `npm run build` / lint clean in `webview-ui`.

## Non-goals

- No changes to the 12 other webview dropdown usages.
- No deletion of the old components.
- No add-item capability in the new component.
