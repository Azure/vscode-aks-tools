import { authentication, AuthenticationSession, EventEmitter } from "vscode";
import { Errorable, failed, getErrorMessage } from "./errorable";
import {
    AzureSubscription,
    getConfiguredAuthProviderId,
    getConfiguredAzureEnv,
    SubscriptionId,
    VSCodeAzureSubscriptionProvider,
} from "@microsoft/vscode-azext-azureauth";
import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { TokenCredential } from "@azure/core-auth";
import { getFilteredSubscriptions } from "./config";
import { parseJson } from "./json";

export type SignInStatus = "Initializing" | "SigningIn" | "SignedIn" | "SignedOut";

export type TokenInfo = {
    token: string;
    expiry: Date;
};

class AksAzureSubscriptionProvider extends VSCodeAzureSubscriptionProvider {
    protected async getSubscriptionFilters(): Promise<SubscriptionId[]> {
        return getFilteredSubscriptions().map((sub) => sub.subscriptionId);
    }

    protected async getTenantFilters(): Promise<string[]> {
        const duplicatedTentantIds = getFilteredSubscriptions().map((sub) => sub.tenantId);
        return [...new Set(duplicatedTentantIds)];
    }
}

const subscriptionProvider = new AksAzureSubscriptionProvider();
const onSignInStatusChangeEmitter = new EventEmitter<SignInStatus>();
let signInStatus: SignInStatus = "Initializing";

subscriptionProvider.onDidSignIn(() => {
    signInStatus = "SignedIn";
    onSignInStatusChangeEmitter.fire(signInStatus);
});

subscriptionProvider.onDidSignOut(() => {
    signInStatus = "SignedOut";
    onSignInStatusChangeEmitter.fire(signInStatus);
});

const initializePromise = initialize();
let signInPromise: Promise<Errorable<void>> | null = null;

export function getSignInStatus(): SignInStatus {
    return signInStatus;
}

export function getSignInStatusChangeEvent() {
    return onSignInStatusChangeEmitter.event;
}

export async function ensureSignedIn(): Promise<Errorable<void>> {
    await initializePromise;
    switch (signInStatus) {
        case "Initializing":
            return { succeeded: false, error: "Azure session status is still initializing." };
        case "SignedOut":
            signInStatus = "SigningIn";
            signInPromise = signIn();
            return await signInPromise;
        case "SigningIn":
            return await signInPromise!;
        case "SignedIn":
            return { succeeded: true, result: undefined };
    }
}

export async function getTenantIds(): Promise<Errorable<string[]>> {
    try {
        const tenants = await subscriptionProvider.getTenants();
        const tenantIds = tenants.map((t) => t.tenantId).filter((id) => id !== undefined) as string[];
        return { succeeded: true, result: tenantIds };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve Azure tenants: ${getErrorMessage(e)}` };
    }
}

export async function getSubscriptions(filter: boolean): Promise<Errorable<AzureSubscription[]>> {
    try {
        const subscriptions = await subscriptionProvider.getSubscriptions(filter);
        return { succeeded: true, result: subscriptions };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve Azure subscriptions: ${getErrorMessage(e)}` };
    }
}

export async function signIn(): Promise<Errorable<void>> {
    try {
        const signedIn = await subscriptionProvider.signIn();
        if (!signedIn) {
            return { succeeded: false, error: "Failed to sign in to Azure." };
        }

        if (signInStatus !== "SignedIn") {
            signInStatus = "SignedIn";
            onSignInStatusChangeEmitter.fire(signInStatus);
        }

        const tenants = await subscriptionProvider.getTenants();
        for (const tenant of tenants) {
            const isSignedIn = await subscriptionProvider.isSignedIn(tenant.tenantId);
            console.log(`Tenant ${tenant.tenantId} is signed in: ${isSignedIn}`);
        }
    } catch (e) {
        signInStatus = "SignedOut";
        onSignInStatusChangeEmitter.fire(signInStatus);
        return { succeeded: false, error: `Failed to sign in to Azure: ${getErrorMessage(e)}` };
    }

    return { succeeded: true, result: undefined };
}

export async function getAuthSession(): Promise<Errorable<AuthenticationSession>> {
    const signInResult = await ensureSignedIn();
    if (failed(signInResult)) {
        return signInResult;
    }

    const providerId = getConfiguredAuthProviderId(); // 'microsoft' or 'microsoft-sovereign-cloud'
    const scopes = [getDefaultScope(getConfiguredAzureEnv().managementEndpointUrl)];

    try {
        const session = await authentication.getSession(providerId, scopes, { createIfNone: false });
        if (!session) {
            return { succeeded: false, error: "No Microsoft authentication session found." };
        }
        return { succeeded: true, result: session };
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve Microsoft authentication session: ${getErrorMessage(e)}`,
        };
    }
}

export function getSubscriptionContext(
    session: AuthenticationSession,
    subscription: AzureSubscription,
): ISubscriptionContext {
    const environment = getConfiguredAzureEnv();
    const providerId = getConfiguredAuthProviderId();
    const scopes = session.scopes;
    const credentials: TokenCredential = {
        getToken: async () => {
            const session = await authentication.getSession(providerId, scopes, { createIfNone: false });
            if (!session) {
                throw new Error("No Microsoft authentication session found.");
            }

            return { token: session.accessToken, expiresOnTimestamp: 0 };
        },
    };

    return {
        credentials,
        subscriptionDisplayName: subscription.name,
        subscriptionId: subscription.subscriptionId,
        subscriptionPath: `/subscriptions/${subscription.subscriptionId}`,
        tenantId: subscription.tenantId,
        userId: session.account.id,
        environment,
        isCustomCloud: environment.name === "AzureCustomCloud",
    };
}

export function getTokenInfo(session: AuthenticationSession): Errorable<TokenInfo> {
    const jwtToken = session.accessToken;
    const tokenParts = jwtToken.split(".");
    if (tokenParts.length !== 3) {
        return { succeeded: false, error: `Invalid JWT token: ${jwtToken}` };
    }

    const body = tokenParts[1];
    let jsonBody: string;
    try {
        jsonBody = Buffer.from(body, "base64").toString();
    } catch (e) {
        return { succeeded: false, error: `Failed to decode JWT token body: ${body}` };
    }

    const jwt = parseJson<Jwt>(jsonBody);
    if (failed(jwt)) {
        return jwt;
    }

    const tokenInfo: TokenInfo = {
        token: jwtToken,
        expiry: new Date(jwt.result.exp * 1000),
    };

    return { succeeded: true, result: tokenInfo };
}

interface Jwt {
    aud: string;
    exp: number;
    iat: number;
    iss: string;
    nbf: number;
    oid: string;
    sub: string;
    tid: string;
    ver: string;
}

async function initialize(): Promise<void> {
    const isSignedIn = await subscriptionProvider.isSignedIn();
    signInStatus = isSignedIn ? "SignedIn" : "SignedOut";
    onSignInStatusChangeEmitter.fire(signInStatus);
}

function getDefaultScope(endpointUrl: string): string {
    return endpointUrl.endsWith("/") ? `${endpointUrl}.default` : `${endpointUrl}/.default`;
}
