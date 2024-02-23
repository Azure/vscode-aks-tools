export type DialogResource<TContentDefinition> = Extract<keyof TContentDefinition, string>;

export type AllDialogsState<TContentDefinition> = {
    [P in DialogResource<TContentDefinition> as `${P}State`]: {
        shown: boolean;
        content: TContentDefinition[P];
    };
};

export type DialogState<
    TContentDefinition,
    T extends DialogResource<TContentDefinition>,
> = AllDialogsState<TContentDefinition>[`${T}State`];

export type DialogVisibilityValue<TContentDefinition> = {
    [P in DialogResource<TContentDefinition>]: {
        dialog: P;
        shown: boolean;
    };
}[DialogResource<TContentDefinition>];

export type DialogContentValue<TContentDefinition> = {
    [P in DialogResource<TContentDefinition>]: {
        dialog: P;
        content: TContentDefinition[P];
    };
}[DialogResource<TContentDefinition>];

type AllDialogsStateKey<TContentDefinition> = Extract<keyof AllDialogsState<TContentDefinition>, string>;

export function updateDialogVisibility<TContentDefinition>(
    allDialogsState: AllDialogsState<TContentDefinition>,
    visibilityValue: DialogVisibilityValue<TContentDefinition>,
): AllDialogsState<TContentDefinition> {
    const stateKey: AllDialogsStateKey<TContentDefinition> = `${visibilityValue.dialog}State`;
    const dialogState = allDialogsState[stateKey];
    return {
        ...allDialogsState,
        [stateKey]: { ...dialogState, shown: visibilityValue.shown },
    };
}

export function updateDialogContent<TContentDefinition>(
    allDialogsState: AllDialogsState<TContentDefinition>,
    stateValue: DialogContentValue<TContentDefinition>,
): AllDialogsState<TContentDefinition> {
    const stateKey: AllDialogsStateKey<TContentDefinition> = `${stateValue.dialog}State`;
    const dialogState = allDialogsState[stateKey];
    return {
        ...allDialogsState,
        [stateKey]: { ...dialogState, content: stateValue.content },
    };
}
