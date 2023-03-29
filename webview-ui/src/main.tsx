import { StrictMode } from "react";
import ReactDOM from "react-dom";
import './index.css';
import './vars.css';
import { TestScenarioSelector } from "./TestScenarioSelector/TestScenarioSelector";
import * as ContractTypes from "../../src/webview-contract/webviewTypes";
import { TestStyleViewer } from "./TestStyleViewer/TestStyleViewer";
import { getTestStyleViewerScenarios } from "./TestStyleViewer/manualTest";
import { getPeriscopeScenarios } from "./Periscope/manualTest";
import { Periscope } from "./Periscope/Periscope";

// There are two modes of launching this application:
// 1. Via the VS Code extension inside a Webview.
// 2. In a browser using a local web server.
//
// We cater for these differences here. These are:
// - Content selection:
//   1. the VS Code extension will specify the content using a 'data-contentid' attribute on the root element.
//   2. the browser will display a list of manual test scenarios for the user to choose from.
// - Initial state:
//   1. the VS Code extension will specify initial state as a JSON-serialized value in the 'data-initialstate'
//      attribute on the root element.
//   2. the browser will use test data provided by each of the components.
// - Message passing:
//   1. the VS code extension will handle outgoing messages from React components (sent using `vscode.postMessage`)
//      and its responses (using `Webview.postMessage`) will be picked up by adding a `message` listener to the
//      `window` object.
//   2. the browser will use a test subscriber that intercepts messages from React components and responds by
//      dispatching `message` events to the `window` object so that application components can listen to them
//      in the same way.

const rootElem = document.getElementById("root");

function getVsCodeContent(): JSX.Element | null {
    const vscodeContentId = rootElem?.dataset.contentid;
    if (!vscodeContentId) {
        return null;
    }

    const vsCodeInitialState = JSON.parse(rootElem?.dataset.initialstate || "{}");
    switch (vscodeContentId) {
        case ContractTypes.TestStyleViewerTypes.contentId: return <TestStyleViewer {...vsCodeInitialState} />
        case ContractTypes.PeriscopeTypes.contentId: return <Periscope {...vsCodeInitialState} />
        default: throw new Error(`Unexpected content ID: '${vscodeContentId}'`);
    }
}

const testScenarios = [
    ...getTestStyleViewerScenarios(),
    ...getPeriscopeScenarios()
];

const testScenarioNames = testScenarios.map(f => f.name);

ReactDOM.render(
    <StrictMode>
        {getVsCodeContent() || <TestScenarioSelector testScenarioNames={testScenarioNames} onTestScenarioChange={handleTestScenarioChange} />}
    </StrictMode>,
    rootElem
);

function handleTestScenarioChange(name: string): JSX.Element {
    const scenario = testScenarios.find(f => f.name === name);
    if (!scenario) {
        throw new Error(`Test scenario '${name}' not found.`);
    }

    return scenario.factory();
}
