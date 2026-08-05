import { useEffect } from "react";
import { CssRule, InitialState } from "../../../src/webview-contract/webviewDefinitions/testStyleViewer";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function TestStyleViewer(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    const isStyleRule = (r: CSSRule): r is CSSStyleRule => "selectorText" in r;

    // Run once on mount to capture CSS vars and rules and report them back to the extension
    useEffect(() => {
        function getCssVarsForVsCode(): string[] {
            const htmlStyle = document.querySelector("html")?.getAttribute("style");
            if (!htmlStyle) {
                return [];
            }

            return getCssVars(htmlStyle);
        }

        function getCssVarsForWebview(): string[] {
            const matchingStyleSheets = [...document.styleSheets]
                .filter((s) => !s.href)
                .filter(
                    (s) => [...s.cssRules].filter((r) => isStyleRule(r) && r.selectorText === ":root").length === 1,
                );

            if (matchingStyleSheets.length !== 1) {
                return [];
            }

            const rule = matchingStyleSheets[0].cssRules.item(0) as CSSStyleRule;
            const properties = rule.cssText.replace(/^\s*:root\s*{/, "").replace(/}\s*$/, "");
            return getCssVars(properties);
        }

        function getCssVars(styleProperties: string) {
            return styleProperties
                .split(";")
                .map((s) => s.trim())
                .filter((s) => s.startsWith("--vscode-"))
                .sort();
        }

        // VS Code 1.130+ wraps its injected default webview styles in a CSS `@layer` block,
        // so the `_defaultStyles` sheet exposes a single top-level CSSLayerBlockRule instead of
        // flat CSSStyleRules. Recurse into any grouping rule (@layer / @media / @supports) to
        // collect the actual style rules; reading only top-level rules yields an empty list.
        function collectStyleRules(rules: CSSRuleList): CSSStyleRule[] {
            const collected: CSSStyleRule[] = [];
            for (const rule of [...rules]) {
                if (isStyleRule(rule)) {
                    collected.push(rule);
                } else if ("cssRules" in rule) {
                    collected.push(...collectStyleRules((rule as CSSGroupingRule).cssRules));
                }
            }
            return collected;
        }

        function getCssRules(): CssRule[] {
            const defaultStyleSheetNode = getStyleSheetNode();
            const [defaultStyleSheet] = [...document.styleSheets].filter((s) => s.ownerNode === defaultStyleSheetNode);
            if (!defaultStyleSheet) {
                return [];
            }

            return collectStyleRules(defaultStyleSheet.cssRules).map((r) => ({
                selector: r.selectorText,
                text: r.cssText,
            }));
        }

        function getStyleSheetNode(): HTMLElement | null {
            if (state.isVSCode) {
                return document.getElementById("_defaultStyles");
            }
            return [...document.querySelectorAll("style")].filter((e) =>
                (e.dataset.viteDevId || "").endsWith("main.css"),
            )[0];
        }

        const cssVars = state.isVSCode ? getCssVarsForVsCode() : getCssVarsForWebview();
        eventHandlers.onCssVarsUpdate(cssVars);

        const cssRules = getCssRules();
        eventHandlers.onCssRulesUpdate(cssRules);

        vscode.postReportCssVars({ cssVars });
        vscode.postReportCssRules({ rules: cssRules });
    }, [eventHandlers, state.isVSCode]);

    function showCssVars() {
        return `:root {\n${state.cssVars.map((s) => `  ${s};`).join("\n")}\n}`;
    }

    function showRules() {
        return state.cssRules.map((r) => r.text).join("\n");
    }

    return (
        <>
            <pre>
                {showCssVars()}
                {"\n"}
                {showRules()}
            </pre>
        </>
    );
}
