import { MessageSubscriber } from "../../../src/webview-contract/messaging";
import { TestStyleViewerTypes } from "../../../src/webview-contract/webviewTypes";
import { Scenario } from "./../utilities/manualTest";
import { getTestVscodeMessageContext } from "./../utilities/vscode";
import { TestStyleViewer } from "./../TestStyleViewer/TestStyleViewer";

export function getTestStyleViewerScenarios() {
    const webview = getTestVscodeMessageContext<TestStyleViewerTypes.ToWebViewCommands, TestStyleViewerTypes.ToVsCodeCommands>();
    const subscriber = MessageSubscriber.create<TestStyleViewerTypes.ToVsCodeCommands>()
        .withHandler("reportCssVars", handleReportCssVars)
        .withHandler("reportCssRules", handleReportCssRules);

    function handleReportCssVars(message: TestStyleViewerTypes.ReportCssVars) {
        console.log(message.cssVars.join('\n'));
    }

    function handleReportCssRules(message: TestStyleViewerTypes.ReportCssRules) {
        console.log(message.rules.map(r => r.text).join('\n'));
    }

    const initialState: TestStyleViewerTypes.InitialState = {
        isVSCode: false
    };

    return [
        Scenario.create(TestStyleViewerTypes.contentId, () => <TestStyleViewer {...initialState} />).withSubscription(webview, subscriber)
    ];
}
