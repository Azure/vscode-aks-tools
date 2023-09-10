import { useEffect, useRef } from "react";

interface DialogProps {
    isShown: boolean
    onCancel: () => void
}

export function Dialog(props: React.PropsWithChildren<DialogProps>) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        document.body.addEventListener("click", handleDocumentClick);
        return () => document.removeEventListener("click", handleDocumentClick);
    });

    useEffect(() => {
        dialogRef.current?.addEventListener("close", handleClose);
        return () => dialogRef.current?.removeEventListener("close", handleClose);
    });

    useEffect(() => {
        if (props.isShown && !dialogRef.current!.hasAttribute("open")) {
            dialogRef.current!.showModal();
        } else if (!props.isShown && dialogRef.current!.hasAttribute("open")) {
            dialogRef.current!.close();
        }
    }, [props.isShown, dialogRef]);

    function handleClose() {
        if (props.isShown) {
            props.onCancel();
        }
    }

    function handleDocumentClick(e: MouseEvent) {
        if(e.target === dialogRef.current) {
            e.preventDefault();
            e.stopPropagation();
            dialogRef.current!.close();
        }
    }

    return (
        <dialog ref={dialogRef}>
            {props.children}
        </dialog>
    )
}