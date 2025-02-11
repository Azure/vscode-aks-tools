import * as vscode from "vscode";

//Defines a type that represents a function that returns void or null, initalized to null
let resolveCallback: (() => void) | null = null;

// Create a Promise with a timeout
export const onCallbackHandled = new Promise<void>((resolve, reject) => {
    resolveCallback = resolve;

    const timeout = setTimeout(() => {
        reject(new Error("Timeout: Callback was not handled within the expected time."));
        resolveCallback = null; // Clear the callback
    }, 180000); //3 Minute Timeout

    // Ensure the timeout is cleared when the Promise resolves
    resolveCallback = () => {
        clearTimeout(timeout);
        resolve();
        resolveCallback = null; // Ensure the Promise resolves only once
    };
});

//Gets called once upon extension registration in the extension.ts file
export function registerUriHandler(context: vscode.ExtensionContext) {
    const handleUri = (uri: vscode.Uri) => {
        vscode.window.showInformationMessage("inside handleUri");

        if (uri.path === "/callback") {
            vscode.window.showInformationMessage("AKS extension: Handling callback");
            console.log("AKS extension: Handling callback");

            // Resolve the Promise
            // Checks to make sure resolveCallback is not null
            if (resolveCallback) {
                resolveCallback(); // Calls the resolve function
            }
        } else {
            console.log(`Unexpected URI path: ${uri.path}`);
        }
    };

    // Register the URI handler
    context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }));
}
