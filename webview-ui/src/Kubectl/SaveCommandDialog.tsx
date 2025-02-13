import { FormEvent, useState } from "react";
import { Dialog } from "../components/Dialog";
import styles from "./Kubectl.module.css";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface SaveCommandDialogProps {
    isShown: boolean;
    existingNames: string[];
    onCancel: () => void;
    onAccept: (name: string) => void;
}

export function SaveCommandDialog(props: SaveCommandDialogProps) {
    const [name, setName] = useState("");

    const existingNameExists = Object.fromEntries(props.existingNames.map((name) => [name, true]));

    function canSave() {
        const nameToSave = name.trim();
        return nameToSave.length > 0 && !existingNameExists[nameToSave];
    }

    function handleNameChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        setName(input.value);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!canSave()) {
            return;
        }

        props.onAccept(name.trim());
    }

    return (
        <Dialog isShown={props.isShown} onCancel={() => props.onCancel()}>
            <h2>Save Command As</h2>

            <form onSubmit={handleSubmit}>
                <hr />

                <div className={styles.inputContainer}>
                    <label htmlFor="cmd-name-input" className={styles.label}>
                        Name
                    </label>
                    <input
                        type="text"
                        id="command-input"
                        className={styles.control}
                        value={name}
                        onInput={handleNameChange}
                    />
                </div>

                <hr />

                <div className={styles.buttonContainer}>
                    <button type="submit" disabled={!canSave()}>
                        Ok
                    </button>
                    <button onClick={props.onCancel}>Cancel</button>
                </div>
            </form>
        </Dialog>
    );
}
