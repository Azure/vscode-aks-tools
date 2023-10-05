import { StrictMode } from "react";
import ReactDOM from "react-dom";
import './vars.css';
import '../main.css';
import { TestScenarioSelector } from "./TestScenarioSelector/TestScenarioSelector";
import { getTestStyleViewerScenarios } from "./testStyleViewerTests";
import { getPeriscopeScenarios } from "./periscopeTests";
import { getDetectorScenarios } from "./detectorTests";
import { getInspektorGadgetScenarios } from "./inspektorGadgetTests";
import { getKubectlScenarios } from "./kubectlTests";
import { ContentId } from "../../../src/webview-contract/webviewTypes";
import { Scenario } from "../utilities/manualTest";
import { getASOScenarios } from "./asoTests";

// There are two modes of launching this application:
// 1. Via the VS Code extension inside a Webview.
// 2. In a browser using a local web server.
//
// This entrypoint is for the browser:
// - Content selection: the browser will display a list of manual test scenarios for the user to choose from.
// - Initial state: the browser will use test data provided by each of the components.
// - Message passing: the browser will use a test subscriber that intercepts messages from React components and responds by
//   dispatching `message` events to the `window` object so that application components can listen to them in the same way.

const rootElem = document.getElementById("root");

const contentTestScenarios: Record<ContentId, Scenario[]> = {
    style: getTestStyleViewerScenarios(),
    periscope: getPeriscopeScenarios(),
    detector: getDetectorScenarios(),
    gadget: getInspektorGadgetScenarios(),
    kubectl: getKubectlScenarios(),
    aso: getASOScenarios()
};

const testScenarios = Object.values(contentTestScenarios).flatMap(s => s);

const testScenarioNames = testScenarios.map(f => f.name);

ReactDOM.render(
    <StrictMode>
        <TestScenarioSelector testScenarioNames={testScenarioNames} onTestScenarioChange={handleTestScenarioChange} />
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
