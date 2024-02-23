import { DialogEventDef, StateWithDialogsState } from "../../utilities/dialogState";
import { Validatable, unset } from "../../utilities/validation";

export type DraftDialogDefinition = {
    newClusterNamespace: { namespace: Validatable<string> };
    newRepository: { repository: Validatable<string> };
    newImageTag: { imageTag: Validatable<string> };
};

export type DraftDialogEventDef = DialogEventDef<DraftDialogDefinition>;

export type DraftStateWithDialogsState = StateWithDialogsState<DraftDialogDefinition>;

export const initialDraftDialogState: DraftStateWithDialogsState = {
    allDialogsState: {
        newClusterNamespaceState: { shown: false, content: { namespace: unset() } },
        newRepositoryState: { shown: false, content: { repository: unset() } },
        newImageTagState: { shown: false, content: { imageTag: unset() } },
    },
};
