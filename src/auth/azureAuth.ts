import {
    AuthenticationSession,
    Disposable as VsCodeDisposable,
    ProgressLocation,
    ProgressOptions,
    QuickPickItem,
    window,
} from "vscode";
import { AzureSessionProvider, ReadyAzureSessionProvider, Tenant, TokenInfo, isReady } from "./types";
import { Environment } from "@azure/ms-rest-azure-env";
import { getConfiguredAzureEnv } from "../commands/utils/config";
import { Errorable, failed } from "../commands/utils/errorable";
import { TokenCredential } from "@azure/core-auth";
import { parseJson } from "../commands/utils/json";
import { getSessionProvider } from "./azureSessionProvider";

export function getEnvironment(): Environment {
    return getConfiguredAzureEnv();
}

export async function getReadySessionProvider(): Promise<Errorable<ReadyAzureSessionProvider>> {
    const sessionProvider = getSessionProvider();
    if (isReady(sessionProvider)) {
        return { succeeded: true, result: sessionProvider };
    }

    switch (sessionProvider.signInStatus) {
        case "Initializing":
        case "SigningIn":
            await waitForSignIn(sessionProvider);
            break;
        case "SignedOut":
            await sessionProvider.signIn();
            break;
        case "SignedIn":
            break;
    }

    // Get a session, which will prompt the user to select a tenant if necessary.
    const session = await sessionProvider.getAuthSession();
    if (failed(session)) {
        return { succeeded: false, error: `Failed to get authentication session: ${session.error}` };
    }

    if (!isReady(sessionProvider)) {
        return { succeeded: false, error: "Not signed in." };
    }

    return { succeeded: true, result: sessionProvider };
}

async function waitForSignIn(sessionProvider: AzureSessionProvider): Promise<void> {
    const options: ProgressOptions = {
        location: ProgressLocation.Notification,
        title: "Waiting for sign-in",
        cancellable: true,
    };

    await window.withProgress(options, (_, token) => {
        let listener: VsCodeDisposable | undefined;
        token.onCancellationRequested(listener?.dispose());
        return new Promise((resolve) => {
            listener = sessionProvider.signInStatusChangeEvent((status) => {
                if (status === "SignedIn") {
                    listener?.dispose();
                    resolve(undefined);
                }
            });
        });
    });
}

export function getCredential(sessionProvider: ReadyAzureSessionProvider): TokenCredential {
    return {
        getToken: async () => {
            const session = await sessionProvider.getAuthSession();
            if (failed(session)) {
                throw new Error(`No Microsoft authentication session found: ${session.error}`);
            }

            return { token: session.result.accessToken, expiresOnTimestamp: 0 };
        },
    };
}

export function getTokenInfo(session: AuthenticationSession): Errorable<TokenInfo> {
    const tokenParts = session.accessToken.split(".");
    if (tokenParts.length !== 3) {
        return { succeeded: false, error: `Access token not a valid JWT: ${session.accessToken}` };
    }

    const body = tokenParts[1];
    let jsonBody: string;
    try {
        jsonBody = Buffer.from(body, "base64").toString();
    } catch (e) {
        return { succeeded: false, error: `Failed to decode JWT token body: ${body}, with error ${e}` };
    }

    const jwt = parseJson<Jwt>(jsonBody);
    if (failed(jwt)) {
        return jwt;
    }

    const tokenInfo: TokenInfo = {
        token: session.accessToken,
        expiry: new Date(jwt.result.exp * 1000),
    };

    return { succeeded: true, result: tokenInfo };
}

export function getDefaultScope(endpointUrl: string): string {
    // Endpoint URL is that of the audience, e.g. for ARM in the public cloud
    // it would be "https://management.azure.com".
    return endpointUrl.endsWith("/") ? `${endpointUrl}.default` : `${endpointUrl}/.default`;
}

/**
 * The type of a JSON-parsed JWT body. Right now we only make use of the 'exp' field,
 * but other standard claims could be added here if needed.
 */
interface Jwt {
    exp: number;
}

export async function quickPickTenant(tenants: Tenant[]): Promise<Tenant | undefined> {
    const items: (QuickPickItem & { tenant: Tenant })[] = tenants.map((t) => ({
        label: `${t.name} (${t.id})`,
        tenant: t,
    }));
    const result = await window.showQuickPick(items, {
        placeHolder: "Select a tenant",
    });
    return result ? result.tenant : undefined;
}
