import { useEffect, useRef } from "react";

interface DialogProps {
    isShown: boolean;
    onCancel: () => void;
}

export function Dialog(props: React.PropsWithChildren<DialogProps>) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    // Keep refs to latest props so handlers don't capture stale closures.
    const onCancelRef = useRef(props.onCancel);
    useEffect(() => {
        onCancelRef.current = props.onCancel;
    }, [props.onCancel]);

    const isShownRef = useRef(props.isShown);
    useEffect(() => {
        isShownRef.current = props.isShown;
    }, [props.isShown]);

    function handleClose() {
        if (isShownRef.current) {
            onCancelRef.current();
        }
    }

    function handleDocumentClick(e: MouseEvent) {
        if (e.target === dialogRef.current) {
            e.preventDefault();
            e.stopPropagation();
            dialogRef.current!.close();
        }
    }

    useEffect(() => {
        document.body.addEventListener("click", handleDocumentClick);
        return () => document.removeEventListener("click", handleDocumentClick);
    }, []);

    useEffect(() => {
        const elem = dialogRef.current;
        if (!elem) return;
        elem.addEventListener("close", handleClose);
        return () => elem.removeEventListener("close", handleClose);
    }, []);

    useEffect(() => {
        if (props.isShown && !dialogRef.current!.hasAttribute("open")) {
            dialogRef.current!.showModal();
        } else if (!props.isShown && dialogRef.current!.hasAttribute("open")) {
            dialogRef.current!.close();
        }
    }, [props.isShown, dialogRef]);

    return <dialog ref={dialogRef}>{props.children}</dialog>;
}
