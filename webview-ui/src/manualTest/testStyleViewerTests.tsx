import { MessageHandler } from "../../../src/webview-contract/messaging";
import { CssRule, InitialState, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/testStyleViewer";
import { Scenario } from "./../utilities/manualTest";
import { getTestVscodeMessageContext } from "./../utilities/vscode";
import { TestStyleViewer } from "./../TestStyleViewer/TestStyleViewer";

export function getTestStyleViewerScenarios() {
    const webview = getTestVscodeMessageContext<"style">();
    const messageHandler: MessageHandler<ToVsCodeMsgDef> = {
        reportCssRules: args => handleReportCssRules(args.rules),
        reportCssVars: args => handleReportCssVars(args.cssVars)
    };

    function handleReportCssVars(cssVars: string[]) {
        console.log(cssVars.join('\n'));
    }

    function handleReportCssRules(rules: CssRule[]) {
        console.log(rules.map(r => r.text).join('\n'));
    }

    const initialState: InitialState = {
        isVSCode: false
    };

    return [
        Scenario.create("Test Style Viewer", () => <TestStyleViewer {...initialState} />).withSubscription(webview, messageHandler)
    ];
}
