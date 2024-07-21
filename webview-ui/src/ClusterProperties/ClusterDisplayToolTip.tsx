import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import styles from "./ClusterProperties.module.css";

export interface ClusterDisplayToolTipProps {
    clusterInfo: ClusterInfo;
}

export function ClusterDisplayToolTip(props: ClusterDisplayToolTipProps) {
    return (
        <span className={styles.tooltip}>
            <span className={styles.infoIndicator}>
                <div className="icon">
                    <i className="codicon codicon-info" aria-label="info icon using vscode icons"></i>
                </div>
            </span>
            <span className={styles.tooltiptext}>
                <table>
                    <caption style={{ fontWeight: "bold", textAlign: "left" }}>Current Versions Available</caption>
                    <tr>
                        <th>Version</th>
                        <th>Patch Versions</th>
                        <th>Support Plan</th>
                        <th>Preview</th>
                    </tr>
                    {props.clusterInfo.supportedVersions.map((v) => (
                        <tr key={v.version}>
                            <td>{v.version}</td>
                            <td>
                                {v.patchVersions.map((patchVersion, index) => (
                                    <div key={`patch-${index}`}>{patchVersion}</div>
                                ))}
                            </td>
                            <td>
                                {v.supportPlan.map((supportPlan, index) => (
                                    <div key={`capability-${index}`}>{supportPlan}</div>
                                ))}
                            </td>
                            <td>{v.isPreview ? "Yes" : "No"}</td>
                        </tr>
                    ))}
                    <tfoot>
                        <tr>
                            <td colSpan={3} style={{ textAlign: "left" }}>
                                <VSCodeLink href="https://learn.microsoft.com/en-us/azure/aks/supported-kubernetes-versions?tabs=azure-cli#aks-kubernetes-release-calendar">
                                    Learn more
                                </VSCodeLink>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </span>
        </span>
    );
}
