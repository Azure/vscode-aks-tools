import { useEffect } from "react";
import { CssRule, InitialState } from "../../../src/webview-contract/webviewDefinitions/testStyleViewer";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function TestStyleViewer(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        const cssVars = state.isVSCode ? getCssVarsForVsCode() : getCssVarsForWebview();
        eventHandlers.onCssVarsUpdate(cssVars);

        const cssRules = getCssRules();
        eventHandlers.onCssRulesUpdate(cssRules);

        vscode.postReportCssVars({ cssVars });
        vscode.postReportCssRules({ rules: cssRules });
    });

    function getCssVarsForVsCode(): string[] {
        const htmlStyle = document.querySelector("html")?.getAttribute("style");
        if (!htmlStyle) {
            return [];
        }

        return getCssVars(htmlStyle);
    }

    const isStyleRule = (r: CSSRule): r is CSSStyleRule => "selectorText" in r;

    function getCssVarsForWebview(): string[] {
        const matchingStyleSheets = [...document.styleSheets]
            .filter((s) => !s.href)
            .filter((s) => [...s.cssRules].filter((r) => isStyleRule(r) && r.selectorText === ":root").length === 1);

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

    function getCssRules(): CssRule[] {
        const defaultStyleSheetNode = getStyleSheetNode();
        const [defaultStyleSheet] = [...document.styleSheets].filter((s) => s.ownerNode === defaultStyleSheetNode);
        if (!defaultStyleSheet) {
            return [];
        }

        return [...defaultStyleSheet.cssRules].filter<CSSStyleRule>(isStyleRule).map((r) => ({
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
