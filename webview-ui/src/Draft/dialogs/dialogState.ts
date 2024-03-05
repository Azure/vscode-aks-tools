import {
    AllDialogsState,
    DialogContentValue,
    DialogVisibilityValue,
    updateDialogContent,
    updateDialogVisibility,
} from "../../utilities/dialogState";
import { StateMessageHandler } from "../../utilities/state";
import { Validatable, unset } from "../../utilities/validation";

export type DraftDialogContentDefinition = {
    newClusterNamespace: { namespace: Validatable<string> };
    newRepository: { repository: Validatable<string> };
    newImageTag: { imageTag: Validatable<string> };
};

export type DraftDialogEventDef = {
    setDialogVisibility: DialogVisibilityValue<DraftDialogContentDefinition>;
    setDialogContent: DialogContentValue<DraftDialogContentDefinition>;
};

export type DraftDialogState = {
    allDialogsState: AllDialogsState<DraftDialogContentDefinition>;
};

export type DraftDialogMessageHandler<TState extends DraftDialogState> = StateMessageHandler<
    DraftDialogEventDef,
    TState
>;

export const initialDraftDialogState: DraftDialogState = {
    allDialogsState: {
        newClusterNamespaceState: { shown: false, content: { namespace: unset() } },
        newRepositoryState: { shown: false, content: { repository: unset() } },
        newImageTagState: { shown: false, content: { imageTag: unset() } },
    },
};

export function getDraftDialogEventHandler<TState extends DraftDialogState>(): StateMessageHandler<
    DraftDialogEventDef,
    TState
> {
    return {
        setDialogVisibility: (state, msg) => ({
            ...state,
            allDialogsState: updateDialogVisibility(state.allDialogsState, msg),
        }),
        setDialogContent: (state, msg) => ({
            ...state,
            allDialogsState: updateDialogContent(state.allDialogsState, msg),
        }),
    };
}
