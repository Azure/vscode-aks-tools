import { useEffect, useState } from "react";
import { TestDialogEvents } from "../utilities/testDialogEvents";
import { Directory } from "../utilities/testFileSystemUtils";
import {
    OpenFileOptions,
    OpenFileResult,
    SaveFileOptions,
    SaveFileResult,
} from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { FilePicker } from "./FilePicker";

export type FilePickerWrapperProps = {
    events: TestDialogEvents;
    rootDir: Directory;
};

export function FilePickerWrapper(props: React.PropsWithChildren<FilePickerWrapperProps>) {
    const [filePickerOptions, setFilePickerOptions] = useState<SaveFileOptions | OpenFileOptions | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        props.events.onOpenFileRequest((options) => {
            setIsSaving(false);
            setFilePickerOptions(options);
        });
        props.events.onSaveFileRequest((options) => {
            setIsSaving(true);
            setFilePickerOptions(options);
        });
    }, [props.events]);

    function handleFilePickerClose(result: SaveFileResult | OpenFileResult | null) {
        setFilePickerOptions(null);
        if (isSaving) {
            props.events.notifySaveFileResult(result as SaveFileResult);
        } else {
            props.events.notifyOpenFileResult(result as OpenFileResult);
        }
    }

    return (
        <>
            {props.children}
            {filePickerOptions && (
                <FilePicker
                    shown={true}
                    isSaving={isSaving}
                    options={filePickerOptions}
                    closeRequested={handleFilePickerClose}
                    rootDir={props.rootDir}
                />
            )}
        </>
    );
}
