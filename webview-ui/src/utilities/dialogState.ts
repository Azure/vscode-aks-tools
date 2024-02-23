/*
Utility types for expressing dialog definitions and state, where an example definition might look like:
type ExampleDialogDefinition = {
    createNewThing: { category: string, name: string };
    deleteThings: { names: string[] };
};

And the corresponding state might look like:
type ExampleDialogState = {
    createNewThingState: { shown: boolean, content: { category: "goodthings", name: "New thing" } };
    deleteThingsState: {  shown: boolean, content: { names: ["Old thing 1", "Old thing 2"] } };
};

Here, "createNewThing" and "deleteThings" are the dialog resources, and the corresponding state keys are
"createNewThingState" and "deleteThingsState".
*/

import { StateMessageHandler } from "./state";

/**
 * Type repesenting the dialog resources (the string keys of a dialog definition).
 */
type DialogResource<TDefinition> = Extract<keyof TDefinition, string>;

/**
 * Type representing the key of a dialog state object.
 */
type DialogStateKey<TResource extends string> = `${TResource}State`;

/**
 * Type representing the state keys for a given dialog definition.
 */
type StateKey<TDefinition> = DialogStateKey<DialogResource<TDefinition>>;

/**
 * Type representing the state of a single dialog for a given dialog definition.
 */
export type SingleDialogState<TDefinition, TResource extends DialogResource<TDefinition>> = {
    shown: boolean;
    content: TDefinition[TResource];
};

/**
 * Type representing the state of all dialogs for a given dialog definition.
 */
export type AllDialogsState<TDefinition> = {
    [P in DialogResource<TDefinition> as DialogStateKey<P>]: SingleDialogState<TDefinition, P>;
};

/**
 * Type representing the state of a webview including all dialogs.
 */
export type StateWithDialogsState<TDefinition> = {
    allDialogsState: AllDialogsState<TDefinition>;
};

type DialogVisibilityMessage<TDefinition, TResource extends DialogResource<TDefinition>> = {
    dialog: TResource;
    shown: boolean;
};

type DialogContentMessage<TDefinition, TResource extends DialogResource<TDefinition>> = {
    dialog: TResource;
    content: TDefinition[TResource];
};

/**
 * Type representing the event message definitions for a given dialog definition.
 * This comprises two message types:
 * - setDialogVisibility: a message to set the visibility of a dialog
 * - setDialogContent: a message to set the content of a dialog
 */
export type DialogEventDef<TDefinition> = {
    setDialogVisibility: DialogVisibilityMessage<TDefinition, DialogResource<TDefinition>>;
    setDialogContent: DialogContentMessage<TDefinition, DialogResource<TDefinition>>;
};

/**
 * Gets an event handler for handling messages that update dialog state.
 */
export function getDialogEventHandler<
    TDefinition,
    TState extends StateWithDialogsState<TDefinition>,
>(): StateMessageHandler<DialogEventDef<TDefinition>, TState> {
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

function updateDialogVisibility<TDefinition>(
    allDialogsState: AllDialogsState<TDefinition>,
    visibilityValue: DialogVisibilityMessage<TDefinition, DialogResource<TDefinition>>,
): AllDialogsState<TDefinition> {
    const stateKey: StateKey<TDefinition> = `${visibilityValue.dialog}State`;
    const dialogState = allDialogsState[stateKey];
    return {
        ...allDialogsState,
        [stateKey]: { ...dialogState, shown: visibilityValue.shown },
    };
}

function updateDialogContent<TDefinition>(
    allDialogsState: AllDialogsState<TDefinition>,
    contentValue: DialogContentMessage<TDefinition, DialogResource<TDefinition>>,
): AllDialogsState<TDefinition> {
    const stateKey: StateKey<TDefinition> = `${contentValue.dialog}State`;
    const dialogState = allDialogsState[stateKey];
    return {
        ...allDialogsState,
        [stateKey]: { ...dialogState, content: contentValue.content },
    };
}
