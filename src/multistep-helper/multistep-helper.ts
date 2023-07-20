import * as vscode from 'vscode';
import { QuickPickItem, window, Disposable, QuickInputButtons} from 'vscode';
import { Errorable, failed } from '../commands/utils/errorable';

// -------------------------------------------------------
// Helper code that wraps the API for the multi-step case.
// -------------------------------------------------------

enum InputFlowAction {
    Back,
    Cancel,
    Next
}

// The result of a single 'step'
type SingleStepOutput<T> = {
    state: Partial<T>,
    flowAction: InputFlowAction
}

// The action that runs a single input step.
type InputStep<T> = (state: Partial<T>, multiStepParams: MultiStepParameters, stepNumber: number) => Promise<SingleStepOutput<T>>;

// Properties applicable to the entire multi-step input.
interface MultiStepParameters {
    title: string;
    totalSteps: number;
}

// Common properties applicable to a single step.
interface StepParameters {
    placeholder?: string;
    ignoreFocusOut?: boolean;
    shouldResume: () => Thenable<boolean>;
}

// Properties applicable specifically to a dropdown step.
interface QuickPickParameters<TState, TItem extends QuickPickItem> extends StepParameters {
    items: TItem[];
    getActiveItem: (state: Partial<TState>) => TItem | void;
    storeItem: (state: Partial<TState>, item: TItem) => Partial<TState>;
}

// Properties applicable specifically to a text input step.
interface InputBoxParameters<TState> extends StepParameters {
    getValue: (state: Partial<TState>) => string | void;
    prompt: string;
    validate: (value: string) => Promise<Errorable<void>>;
    storeValue: (state: Partial<TState>, value: string) => Partial<TState>;
}

export async function runMultiStepInput<T>(title: string, state: Partial<T>, ...steps: [InputStep<T>, ...InputStep<T>[]]): Promise<T | void> {
    let stepIndex = 0;
    while (stepIndex >= 0 && stepIndex < steps.length) {
        const step = steps[stepIndex];
        const stepOutput = await step(state, { title, totalSteps: steps.length }, stepIndex + 1);

        state = stepOutput.state;
        switch (stepOutput.flowAction) {
            case InputFlowAction.Back:
                stepIndex--;
                break;
            case InputFlowAction.Cancel:
                stepIndex = -1;
                break;
            case InputFlowAction.Next:
                stepIndex++;
                break;
        }
    }

    return stepIndex >= steps.length ? state as T : undefined;
}

export function createQuickPickStep<TState, TItem extends QuickPickItem>(params: QuickPickParameters<TState, TItem>): InputStep<TState> {
    return async (state: Partial<TState>, multiStepParams: MultiStepParameters, stepNumber: number) => {
        const input = window.createQuickPick<TItem>();
        input.title = multiStepParams.title;
        input.step = stepNumber;
        input.totalSteps = multiStepParams.totalSteps;
        input.ignoreFocusOut = params.ignoreFocusOut ?? false;
        input.placeholder = params.placeholder;
        input.items = params.items;
        const activeItem = params.getActiveItem(state)
        if (activeItem) {
            input.activeItems = [activeItem];
        }
        input.buttons = stepNumber > 1 ? [QuickInputButtons.Back] : [];

        let disposables: Disposable[] = [];
        const inputPromise = new Promise<SingleStepOutput<TState>>(resolve => {
            disposables = [
                input.onDidTriggerButton(item => {
                    if (item === QuickInputButtons.Back) {
                        resolve({ state, flowAction: InputFlowAction.Back });
                    } else {
                        vscode.window.showErrorMessage("Unexpected button in QuickPick");
                        resolve({ state, flowAction: InputFlowAction.Cancel });
                    }
                }),
                input.onDidChangeSelection(items => {
                    const newState = params.storeItem(state, items[0]);
                    resolve({ state: newState, flowAction: InputFlowAction.Next });
                }),
                input.onDidHide(async () => {
                    const resume = await params.shouldResume();
                    const flowAction = resume ? InputFlowAction.Back : InputFlowAction.Cancel;
                    resolve({ state, flowAction });
                })
            ];
        });

        try {
            input.show();
            return await inputPromise;
        } finally {
            disposables.forEach(d => d.dispose());
            input.dispose();
        }
    };
}

export function createInputBoxStep<TState>(params: InputBoxParameters<TState>): InputStep<TState> {
    return async (state: Partial<TState>, multiStepParams: MultiStepParameters, stepNumber: number) => {
        const input = window.createInputBox();
        input.title = multiStepParams.title;
        input.step = stepNumber;
        input.totalSteps = multiStepParams.totalSteps;
        input.value = params.getValue(state) || '';
        input.prompt = params.prompt;
        input.ignoreFocusOut = params.ignoreFocusOut ?? false;
        input.placeholder = params.placeholder;
        input.buttons = stepNumber > 1 ? [QuickInputButtons.Back] : [];

        let disposables: Disposable[] = [];
        const inputPromise = new Promise<SingleStepOutput<TState>>(resolve => {
            let latestValidation: Promise<Errorable<void>> | null = null;
            disposables = [
                input.onDidTriggerButton(item => {
                    if (item === QuickInputButtons.Back) {
                        resolve({ state, flowAction: InputFlowAction.Back });
                    } else {
                        vscode.window.showErrorMessage("Unexpected button in InputBox");
                        resolve({ state, flowAction: InputFlowAction.Cancel });
                    }
                }),
                input.onDidAccept(async () => {
                    const value = input.value;
                    input.enabled = false;
                    input.busy = true;
                    const validationResult = await params.validate(value);
                    if (failed(validationResult)) {
                        input.validationMessage = validationResult.error;
                        input.enabled = true;
                        input.busy = false;
                    } else {
                        const newState = params.storeValue(state, value);
                        resolve({ state: newState, flowAction: InputFlowAction.Next });
                    }
                }),
                input.onDidChangeValue(async text => {
                    const thisValidation = params.validate(text);
                    latestValidation = thisValidation;
                    const validationResult = await thisValidation;

                    // Only display the validation result if this validation is the latest one.
                    if (thisValidation === latestValidation) {
                        input.validationMessage = failed(validationResult) ? validationResult.error : '';
                    }
                }),
                input.onDidHide(async () => {
                    const resume = await params.shouldResume();
                    const flowAction = resume ? InputFlowAction.Back : InputFlowAction.Cancel;
                    resolve({ state, flowAction });
                })
            ];
        });

        try {
            input.show();
            return await inputPromise;
        } finally {
            disposables.forEach(d => d.dispose());
            input.dispose();
        }
    };
}
