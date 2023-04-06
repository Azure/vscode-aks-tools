import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { DetectorTypes } from "../../../src/webview-contract/webviewTypes";
import { SingleDetector } from './SingleDetector';

export function Detector(props: DetectorTypes.InitialState) {
    const portalUrl = `https://portal.azure.com/#resource${props.clusterArmId}aksDiagnostics?referrer_source=vscode&referrer_context=${props.portalReferrerContext}`;

    return (
    <>
        <h2>{props.name}</h2>
        {props.description && props.description !== "test" && <p>{props.description}</p>}
        To perform more checks on your cluster, visit <VSCodeLink href={portalUrl}>AKS Diagnostics</VSCodeLink>.
        <VSCodeDivider style={{marginTop: "16px"}} />

        {props.detectors.map(detector => (
            <SingleDetector key={detector.name} {...detector}></SingleDetector>
        ))}
    </>
    )
}