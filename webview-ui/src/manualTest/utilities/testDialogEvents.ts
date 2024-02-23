import {
    OpenFileOptions,
    OpenFileResult,
    SaveFileOptions,
    SaveFileResult,
} from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";

export class TestDialogEvents extends EventTarget {
    notifySaveFileResult(result: SaveFileResult | null) {
        this.dispatchEvent(new CustomEvent("saveFileResult", { detail: result }));
    }

    notifyOpenFileResult(result: OpenFileResult | null) {
        this.dispatchEvent(new CustomEvent("openFileResult", { detail: result }));
    }

    onSaveFileRequest(handler: (options: SaveFileOptions) => void) {
        this.addEventListener("saveFileRequest", (e) => {
            const customEvent = e as CustomEvent;
            const options = customEvent.detail as SaveFileOptions;
            handler(options);
        });
    }

    onOpenFileRequest(handler: (options: OpenFileOptions) => void) {
        this.addEventListener("openFileRequest", (e) => {
            const customEvent = e as CustomEvent;
            const options = customEvent.detail as OpenFileOptions;
            handler(options);
        });
    }

    async saveFile(options: SaveFileOptions): Promise<SaveFileResult | null> {
        let handler: (item: SaveFileResult | null) => void;
        const listener: EventListener = (e) => {
            const result = (e as CustomEvent).detail as SaveFileResult | null;
            if (handler) {
                handler(result);
            }
        };

        const promise = new Promise<SaveFileResult | null>((resolve) => {
            handler = resolve;
        });

        this.addEventListener("saveFileResult", listener);
        this.dispatchEvent(new CustomEvent("saveFileRequest", { detail: options }));

        const result = await promise;
        this.removeEventListener("saveFileResult", listener);
        return result;
    }

    async openFile(options: OpenFileOptions): Promise<OpenFileResult | null> {
        let handler: (item: OpenFileResult | null) => void;
        const listener: EventListener = (e) => {
            const result = (e as CustomEvent).detail as OpenFileResult | null;
            if (handler) {
                handler(result);
            }
        };

        const promise = new Promise<OpenFileResult | null>((resolve) => {
            handler = resolve;
        });

        this.addEventListener("openFileResult", listener);
        this.dispatchEvent(new CustomEvent("openFileRequest", { detail: options }));

        const result = await promise;
        this.removeEventListener("openFileResult", listener);
        return result;
    }
}
