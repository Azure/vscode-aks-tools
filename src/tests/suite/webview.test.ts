import * as vscode from "vscode";
import { MessageHandler } from "../../webview-contract/messaging";
import { CssRule, InitialState, ToVsCodeMsgDef } from "../../webview-contract/webviewDefinitions/testStyleViewer";
import { BasePanel, PanelDataProvider } from "../../panels/BasePanel";
import { getExtensionPath } from "../../commands/utils/host";
import { map as errmap, Succeeded, succeeded } from "../../commands/utils/errorable";
import { expect } from "chai";

const extensionPathResult = getExtensionPath();
const extensionUriResult = errmap(extensionPathResult, (p) => vscode.Uri.file(p));

describe("Webview Styles", () => {
    it("should contain css variables and rules", async () => {
        expect(succeeded(extensionUriResult)).to.be.true;
        const extensionUri = (extensionUriResult as Succeeded<vscode.Uri>).result;
        const panel = new StyleTestPanel(extensionUri);
        const dataProvider = new StyleTestDataProvider();
        panel.show(dataProvider);

        const cssVars = await dataProvider.cssVarsPromise;
        const rules = await dataProvider.rulesPromise;

        // Place breakpoint here to see CSS variables and rules in test host webview.
        expect(cssVars).to.not.be.empty;
        expect(rules).to.not.be.empty;
    });
});

class StyleTestPanel extends BasePanel<"style"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "style", {});
    }
}

class StyleTestDataProvider implements PanelDataProvider<"style"> {
    readonly cssVarsPromise: Promise<string[]>;
    private cssVarsResolve?: (cssVars: string[]) => void;

    readonly rulesPromise: Promise<CssRule[]>;
    private rulesResolve?: (rules: CssRule[]) => void;

    constructor() {
        this.cssVarsPromise = new Promise((resolve) => (this.cssVarsResolve = resolve));
        this.rulesPromise = new Promise((resolve) => (this.rulesResolve = resolve));
    }

    getTitle(): string {
        return "Style Test";
    }

    getInitialState(): InitialState {
        return { isVSCode: true };
    }

    getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {
            reportCssRules: (args) => this.rulesResolve && this.rulesResolve(args.rules),
            reportCssVars: (args) => this.cssVarsResolve && this.cssVarsResolve(args.cssVars),
        };
    }
}
