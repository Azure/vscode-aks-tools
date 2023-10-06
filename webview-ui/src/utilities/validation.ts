export interface Validatable<T> {
    value: T | null
    isChecked: boolean
    isValid: boolean
    message: string | null
}

export function unset<T>(): Validatable<T> {
    return {
        value: null,
        isChecked: false,
        isValid: false,
        message: null
    }
}

export function shouldShowMessage<T>(v: Validatable<T>): boolean {
    return v.isChecked && !v.isValid;
}

export function createHandler<TValue, TEvent, TElement>(
    elemLookup: (e: TEvent) => TElement,
    valueLookup: (elem: TElement) => TValue | null,
    checkValidity: (elem: TElement) => boolean,
    getMessage: (elem: TElement) => string,
    dispatch: React.Dispatch<React.SetStateAction<Validatable<TValue>>>
): (e: TEvent) => void {
    return e => {
        const elem = elemLookup(e);
        const value = valueLookup(elem);
        const isValid = checkValidity(elem);
        const message = isValid ? null : getMessage(elem);
        dispatch({
            value,
            isChecked: true,
            isValid,
            message
        });
    }
}