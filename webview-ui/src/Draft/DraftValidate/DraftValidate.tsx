import { InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftValidate";
import { useStateManagement } from "../../utilities/state";
import { stateUpdater, vscode } from "./state";
import { useEffect } from "react";

export function DraftValidate(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

    //Request the validation results from the backend once when the component is mounted.
    useEffect(() => {
        vscode.postCreateDraftValidateRequest("");
    }, []);

    return (
        <>
            <h2>Draft Validate</h2>
            <pre>{state.validationResults}</pre>
        </>
    );
}
