import { MessageHandler } from "../../../src/webview-contract/messaging";
import { TestStyleViewerTypes } from "../../../src/webview-contract/webviewTypes";
import { Scenario } from "./../utilities/manualTest";
import { getTestVscodeMessageContext } from "./../utilities/vscode";
import { TestStyleViewer } from "./../TestStyleViewer/TestStyleViewer";

export function getTestStyleViewerScenarios() {
    const webview = getTestVscodeMessageContext<TestStyleViewerTypes.ToWebViewMsgDef, TestStyleViewerTypes.ToVsCodeMsgDef>();
    const messageHandler: MessageHandler<TestStyleViewerTypes.ToVsCodeMsgDef> = {
        reportCssRules: args => handleReportCssRules(args.rules),
        reportCssVars: args => handleReportCssVars(args.cssVars)
    };

    function handleReportCssVars(cssVars: string[]) {
        console.log(cssVars.join('\n'));
    }

    function handleReportCssRules(rules: TestStyleViewerTypes.CssRule[]) {
        console.log(rules.map(r => r.text).join('\n'));
    }

    const initialState: TestStyleViewerTypes.InitialState = {
        isVSCode: false
    };

    return [
        Scenario.create(TestStyleViewerTypes.contentId, () => <TestStyleViewer {...initialState} />).withSubscription(webview, messageHandler)
    ];
}
