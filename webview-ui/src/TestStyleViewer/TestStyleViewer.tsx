import { useEffect, useState } from "react";
import { CssRule, InitialState } from "../../../src/webview-contract/webviewDefinitions/testStyleViewer";
import { getWebviewMessageContext } from "../utilities/vscode";

export function TestStyleViewer(props: InitialState) {
    const vscode = getWebviewMessageContext<"style">();

    const [cssVars, setCssVars] = useState<string[]>([]);
    const [cssRules, setCssRules] = useState<CssRule[]>([]);

    useEffect(() => {
        const cssVars = props.isVSCode ? getCssVarsForVsCode() : getCssVarsForWebview();
        setCssVars(cssVars);

        const cssRules = getCssRules();
        setCssRules(cssRules);

        vscode.postMessage({ command: "reportCssVars", parameters: {cssVars} });
        vscode.postMessage({ command: "reportCssRules", parameters: {rules: cssRules} });
    }, []);

    function getCssVarsForVsCode(): string[] {
        const htmlStyle = document.querySelector('html')?.getAttribute('style');
        if (!htmlStyle) {
            return [];
        }

        return getCssVars(htmlStyle);
    }

    const isStyleRule = (r: CSSRule): r is CSSStyleRule => 'selectorText' in r;

    function getCssVarsForWebview(): string[] {
        const matchingStyleSheets = [...document.styleSheets]
            .filter(s => !s.href)
            .filter(s => [...s.cssRules].filter(r => isStyleRule(r) && r.selectorText === ':root').length === 1);

        if (matchingStyleSheets.length !== 1) {
            return [];
        }

        const rule = matchingStyleSheets[0].cssRules.item(0) as CSSStyleRule;
        const properties = rule.cssText.replace(/^\s*:root\s*{/, "").replace(/}\s*$/, "");
        return getCssVars(properties);
    }

    function getCssVars(styleProperties: string) {
        return styleProperties.split(';').map(s => s.trim()).filter(s => s.startsWith('--vscode-')).sort();
    }

    function getCssRules(): CssRule[] {
        const defaultStyleSheetNode = getStyleSheetNode();
        let [defaultStyleSheet] = [...document.styleSheets].filter(s => s.ownerNode === defaultStyleSheetNode);
        if (!defaultStyleSheet) {
            return [];
        }

        return [...defaultStyleSheet.cssRules].filter<CSSStyleRule>(isStyleRule).map(r => ({
            selector: r.selectorText,
            text: r.cssText
        }));
    }

    function getStyleSheetNode(): HTMLElement | null {
        if (props.isVSCode) {
            return document.getElementById('_defaultStyles');
        }
        return [...document.querySelectorAll('style')].filter(e => (e.dataset.viteDevId || "").endsWith('main.css'))[0];
    }

    function showCssVars() {
        return `:root {\n${cssVars.map(s => `  ${s};`).join('\n')}\n}`;
    }

    function showRules() {
        return cssRules.map(r => r.text).join('\n');
    }

    return (
        <>
            <pre>{showCssVars()}{'\n'}{showRules()}</pre>
        </>
    )
}
