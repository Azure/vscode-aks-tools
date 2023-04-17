import * as vscode from 'vscode';
import { MessageSink, MessageSubscriber } from '../../webview-contract/messaging';
import { TestStyleViewerTypes } from '../../webview-contract/webviewTypes';
import { BasePanel, PanelDataProvider } from '../../panels/BasePanel';
import { getExtensionPath } from '../../commands/utils/host';
import { map as errmap, Succeeded, succeeded } from '../../commands/utils/errorable';
import { expect } from 'chai';

const extensionPathResult = getExtensionPath();
const extensionUriResult = errmap(extensionPathResult, p => vscode.Uri.file(p));

describe('Webview Styles', () => {
    it('should contain css variables and rules', async () => {
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

class StyleTestPanel extends BasePanel<TestStyleViewerTypes.InitialState, TestStyleViewerTypes.ToWebViewCommands, TestStyleViewerTypes.ToVsCodeCommands> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, TestStyleViewerTypes.contentId);
    }
}

class StyleTestDataProvider implements PanelDataProvider<TestStyleViewerTypes.InitialState, TestStyleViewerTypes.ToWebViewCommands, TestStyleViewerTypes.ToVsCodeCommands> {
    readonly cssVarsPromise: Promise<string[]>;
    private _cssVarsResolve?: (cssVars: string[]) => void;

    readonly rulesPromise: Promise<TestStyleViewerTypes.CssRule[]>;
    private _rulesResolve?: (rules: TestStyleViewerTypes.CssRule[]) => void;

    constructor() {
        this.cssVarsPromise = new Promise(resolve => this._cssVarsResolve = resolve);
        this.rulesPromise = new Promise(resolve => this._rulesResolve = resolve);
    }

    getTitle(): string {
        return "Style Test";
    }

    getInitialState(): TestStyleViewerTypes.InitialState {
        return { isVSCode: true };
    }

    createSubscriber(_webview: MessageSink<never>): MessageSubscriber<TestStyleViewerTypes.ToVsCodeCommands> | null {
        return MessageSubscriber.create<TestStyleViewerTypes.ToVsCodeCommands>()
            .withHandler("reportCssVars", msg => this._cssVarsResolve && this._cssVarsResolve(msg.cssVars))
            .withHandler("reportCssRules", msg => this._rulesResolve && this._rulesResolve(msg.rules));
    }
}
