import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/automatedDeployments";
import { stateUpdater } from "../AutomatedDeployments/state";
import { Scenario } from "../utilities/manualTest";
import { AutomatedDeployments } from "../AutomatedDeployments/AutomatedDeployments";
import { TreeNode } from "../../../src/commands/utils/octokitHelper";

//Proper testing not yet implemented. Only serves as placeholder and way to load the page.
export function getAutomatedDeploymentScenarios() {
    const initialState: InitialState = {
        repos: ["..."],
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getGitHubReposRequest: () => {
                console.log("Getting Github repos with getGitHubReposRequest");
                webview.postGetGitHubReposResponse({ repos: ["repo1", "repo2", "bestRepo"] });
            },
            getGitHubBranchesRequest: () => {
                console.log("Getting Github branches with getGitHubBranchesRequest");
                webview.postGetGitHubBranchesResponse({ branches: ["branch1", "branch2", "bestBranch"] });
            },
            getAcrsRequest: () => {
                console.log("Getting acrs with getAcrsRequest");
                webview.postGetAcrsResponse({ acrs: [{ acrName: "acrName" }, { acrName: "daBestAcr" }] });
            },
            getSubscriptionsRequest: () => {
                // implementation here
            },
            getNamespacesRequest: () => {
                console.log("Returning namespaces from getNamespacesRequest");
                webview.postGetNamespacesResponse(["namespace1", "namespace2", "bestnamespaceever-11"]);
            },
            createWorkflowRequest: () => {
                // implementation here
            },
            getResourceGroupsRequest: () => {
                // implementation here
            },
            getRepoTreeStructureRequest: () => {
                console.log("Returning repo tree structure from getRepoTreeStructureRequest");
                const genericTree: TreeNode = {
                    name: "root",
                    path: "",
                    type: "tree",
                    children: [
                        {
                            name: "Folder 1",
                            path: "folder1",
                            type: "tree",
                            children: [
                                {
                                    name: "Subfolder A",
                                    path: "folder1/subfolderA",
                                    type: "tree",
                                    children: [
                                        {
                                            name: "File 1.txt",
                                            path: "folder1/subfolderA/file1.txt",
                                            type: "blob",
                                            children: [],
                                        },
                                        {
                                            name: "File 2.txt",
                                            path: "folder1/subfolderA/file2.txt",
                                            type: "blob",
                                            children: [],
                                        },
                                    ],
                                },
                                {
                                    name: "File 3.txt",
                                    path: "folder1/file3.txt",
                                    type: "blob",
                                    children: [],
                                },
                            ],
                        },
                        {
                            name: "Folder 2",
                            path: "folder2",
                            type: "tree",
                            children: [
                                {
                                    name: "File 4.txt",
                                    path: "folder2/file4.txt",
                                    type: "blob",
                                    children: [],
                                },
                            ],
                        },
                        {
                            name: "File 5.txt",
                            path: "file5.txt",
                            type: "blob",
                            children: [],
                        },
                    ],
                };
                webview.postGetRepoTreeStructureResponse(genericTree);
            },
        };
    }

    return [
        Scenario.create(
            "automatedDeployments",
            "Automated Deployment Placeholder Page",
            () => <AutomatedDeployments {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
