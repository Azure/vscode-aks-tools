import { Dialog } from "../components/Dialog";
import styles from "./RetinaCapture.module.css";

export interface DeleteNodeExplorerDialogProps {
    isShown: boolean;
    nodes: string[];
    onCancel: () => void;
    onAccept: (nodeName: string) => void;
}

export function DeleteNodeExplorerDialog(props: DeleteNodeExplorerDialogProps) {
    function handleYes() {
        props.onAccept(props.nodes.join(","));
    }

    function handleNo() {
        props.onCancel();
    }

    return (
        <Dialog isShown={props.isShown} onCancel={() => props.onCancel()}>
            <h2>Delete Node Explorer</h2>

            <form className={styles.createForm}>
                <div>
                    Are you sure you want to delete the Node Explorer? Deleting the Node Explorer will introduce delay
                    for kubectl copy next time.
                </div>

                <div className={styles.buttonContainer} style={{ justifyContent: "flex-end" }}>
                    <button onClick={handleYes}>Yes</button>
                    <button onClick={handleNo}>No</button>
                </div>
            </form>
        </Dialog>
    );
}
