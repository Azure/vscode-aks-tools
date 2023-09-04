import { createInputBoxStep, runMultiStepInput } from '../../multistep-helper/multistep-helper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { Errorable } from '../utils/errorable';
import { aksKubectlCommands } from './aksKubectlCommands';
import * as vscode from 'vscode';

interface State {
    clusterkubectlcommand: string;
}

/**
 * A single-step input for enabling custom kubectl command.
 */
export default async function aksCustomKubectlCommand(
    _context: IActionContext,
    target: any
): Promise<void> {
    const clusterKubectlCommandStep = createInputBoxStep<State>({
        shouldResume: () => Promise.resolve(false),
        getValue: () => '',
        prompt: 'Please enter the Kubectl command to run against the cluster. \n Please make sure only arguments following kubectl command are provivded rather then typing kubectl. \n For example if command is kubectl get pods then only type get pods',
        validate: validateAKSKubectlClusterCommand,
        storeValue: (state, value) => ({...state, clusterkubectlcommand: value})
    });
    
    const initialState: Partial<State> = {};

    const state = await runMultiStepInput('Run Custom Kubectl Command', initialState, clusterKubectlCommandStep);
    if (!state) {
        // Cancelled
        return;
    }

    const answer = await vscode.window.showInformationMessage(`Do you want to run command: kubectl ${state.clusterkubectlcommand}, against your AKS cluster.`, "Yes", "No");

    if (answer === "Yes") {
        aksKubectlCommands(_context, target, state.clusterkubectlcommand);
    }

}

async function validateAKSKubectlClusterCommand(command: string): Promise<Errorable<void>> {
    if (command.trim().length == 0) {
        return { succeeded: false, error: 'Invalid AKS Cluster Kubectl Command.' };
    }

    return { succeeded: true, result: undefined };
}
