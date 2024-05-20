interface Unset {
    hasValue: false;
    isChecked: false;
}

interface Missing {
    hasValue: false;
    isChecked: true;
    isValid: false;
    message: string;
}

interface Invalid<T> {
    value: T;
    hasValue: true;
    isChecked: true;
    isValid: false;
    message: string;
}

interface Valid<T> {
    value: T;
    hasValue: true;
    isChecked: true;
    isValid: true;
}

export type Validatable<T> = Unset | Missing | Invalid<T> | Valid<T>;

export type ValidatableValue<T> = Invalid<T> | Valid<T>;

export function unset<T>(): Validatable<T> {
    return { isChecked: false, hasValue: false };
}

export function valid<T>(value: T): ValidatableValue<T> {
    return { isChecked: true, isValid: true, hasValue: true, value };
}

export function missing<T>(message: string): Validatable<T> {
    return { isChecked: true, isValid: false, hasValue: false, message };
}

export function invalid<T>(value: T, message: string): ValidatableValue<T> {
    return { isChecked: true, isValid: false, hasValue: true, value, message };
}

export function isValueSet<T>(v: Validatable<T>): v is Invalid<T> | Valid<T> {
    return v.hasValue;
}

export function isValid<T>(v: Validatable<T>): v is Valid<T> {
    return isValueSet(v) && v.isChecked && v.isValid;
}

export function hasMessage<T>(v: Validatable<T>): v is Missing | Invalid<T> {
    return v.isChecked && !v.isValid;
}

export function fromNullable<T>(value: T | null): Validatable<T> {
    return value === null ? unset() : valid(value);
}

export function toNullable<T>(v: Validatable<T>): T | null {
    return isValueSet(v) ? v.value : null;
}

export function orDefault<T, U>(v: Validatable<T>, defaultValue: U): T | U {
    return isValueSet(v) ? v.value : defaultValue;
}
