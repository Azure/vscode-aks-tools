import {
    Disposable as VsCodeDisposable,
    EventEmitter,
    authentication,
    AuthenticationGetSessionOptions,
    AuthenticationSession,
    window,
    QuickPickItem,
} from "vscode";
import { SignInStatus, TokenInfo } from "./types";
import { Environment } from "@azure/ms-rest-azure-env";
import { getConfiguredAzureEnv } from "../commands/utils/config";
import { Errorable, failed, getErrorMessage, succeeded } from "../commands/utils/errorable";
import { TokenCredential } from "@azure/core-auth";
import { parseJson } from "../commands/utils/json";
import { SubscriptionClient, TenantIdDescription } from "@azure/arm-resources-subscriptions";

type AuthProviderId = "microsoft" | "microsoft-sovereign-cloud";

type Tenant = {
    name: string;
    id: string;
};

class AzureSessionProvider extends VsCodeDisposable {
    private readonly initializePromise: Promise<void>;
    private signInPromise: Promise<Errorable<AuthenticationSession>> | null = null;
    private tenants: Tenant[] = [];

    public readonly onSignInStatusChangeEmitter = new EventEmitter<SignInStatus>();
    public signInStatusValue: SignInStatus = "Initializing";

    public constructor() {
        const disposable = authentication.onDidChangeSessions(async (e) => {
            // Ignore events for non-microsoft providers
            if (e.provider.id !== getConfiguredAuthProviderId()) {
                return;
            }

            // Ignore events while we're initializing.
            if (this.signInStatusValue === "Initializing") {
                return;
            }

            // Silently check authentication status and tenants
            await this.signInAndUpdateTenants({ createIfNone: false, silent: true });
        });

        super(() => {
            this.onSignInStatusChangeEmitter.dispose();
            disposable.dispose();
        });

        this.initializePromise = this.initialize();
    }

    public get signInStatus(): SignInStatus {
        return this.signInStatusValue;
    }

    private async initialize(): Promise<void> {
        await this.signInAndUpdateTenants({ createIfNone: false, silent: true });
    }

    public async signIn(): Promise<void> {
        await this.initializePromise;
        if (this.signInPromise) {
            await this.signInPromise;
        } else {
            this.signInStatusValue = "SigningIn";
            this.onSignInStatusChangeEmitter.fire(this.signInStatusValue);
            await this.signInAndUpdateTenants({ createIfNone: true, clearSessionPreference: true });
        }

        this.signInPromise = null;
    }

    private async signInAndUpdateTenants(options: AuthenticationGetSessionOptions): Promise<void> {
        const getSessionResult = await getArmSession(null, options);
        this.tenants = succeeded(getSessionResult) ? await getAuthenticatedTenants(getSessionResult.result) : [];
        const newSignInStatus = this.tenants.length > 0 ? "SignedIn" : "SignedOut";
        if (newSignInStatus !== this.signInStatusValue) {
            this.signInStatusValue = newSignInStatus;
            this.onSignInStatusChangeEmitter.fire(this.signInStatusValue);
        }
    }

    public async getSession(): Promise<Errorable<AuthenticationSession>> {
        await this.initializePromise;
        if (this.signInPromise) {
            return await this.signInPromise;
        }

        if (this.tenants.length === 0) {
            return { succeeded: false, error: "No authenticated tenants found." };
        }

        let tenant: Tenant;
        if (this.tenants.length > 1) {
            const selectedTenant = await quickPickTenant(this.tenants);
            if (!selectedTenant) {
                return { succeeded: false, error: "No tenant selected." };
            }

            tenant = selectedTenant;
        } else {
            tenant = this.tenants[0];
        }

        return await getArmSession(tenant.id, { createIfNone: false, silent: true });
    }
}

const sessionProvider = new AzureSessionProvider();

export function signIn(): Promise<void> {
    return sessionProvider.signIn();
}

export function getSignInStatus(): SignInStatus {
    return sessionProvider.signInStatus;
}

export function getSignInStatusChangeEvent() {
    return sessionProvider.onSignInStatusChangeEmitter.event;
}

export function getAuthSession(): Promise<Errorable<AuthenticationSession>> {
    return sessionProvider.getSession();
}

export function getEnvironment(): Environment {
    return getConfiguredAzureEnv();
}

export function getCredential(): TokenCredential {
    return {
        getToken: async () => {
            const session = await sessionProvider.getSession();
            if (failed(session)) {
                throw new Error("No Microsoft authentication session found.");
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
        return { succeeded: false, error: `Failed to decode JWT token body: ${body}` };
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
    return endpointUrl.endsWith("/") ? `${endpointUrl}.default` : `${endpointUrl}/.default`;
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

async function getArmSession(
    tenantId: string | null,
    options: AuthenticationGetSessionOptions,
): Promise<Errorable<AuthenticationSession>> {
    try {
        const tenantScopes = tenantId ? [`VSCODE_TENANT:${tenantId}`] : [];
        const scopes = [getDefaultScope(getConfiguredAzureEnv().managementEndpointUrl), ...tenantScopes];

        const session = await authentication.getSession(getConfiguredAuthProviderId(), scopes, options);
        if (session) {
            return { succeeded: true, result: session };
        }

        return { succeeded: false, error: "No Azure session found." };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve Azure session: ${getErrorMessage(e)}` };
    }
}

function getConfiguredAuthProviderId(): AuthProviderId {
    return getConfiguredAzureEnv().name === Environment.AzureCloud.name ? "microsoft" : "microsoft-sovereign-cloud";
}

async function getAuthenticatedTenants(session: AuthenticationSession): Promise<Tenant[]> {
    const armEndpoint = getConfiguredAzureEnv().resourceManagerEndpointUrl;
    const credential: TokenCredential = {
        getToken: async () => {
            return { token: session.accessToken, expiresOnTimestamp: 0 };
        },
    };
    const subscriptionClient = new SubscriptionClient(credential, { endpoint: armEndpoint });
    const tenants: Tenant[] = [];
    for await (const page of subscriptionClient.tenants.list().byPage()) {
        tenants.push(...page.filter(asTenant).map((t) => ({ name: t.displayName, id: t.tenantId })));
    }

    const sessions = await Promise.all(tenants.map((t) => getArmSession(t.id, { createIfNone: false, silent: true })));
    return sessions.filter(succeeded).map((_, i) => tenants[i]);
}

function asTenant(tenant: TenantIdDescription): tenant is { tenantId: string; displayName: string } {
    return tenant.tenantId !== undefined && tenant.displayName !== undefined;
}

async function quickPickTenant(tenants: Tenant[]): Promise<Tenant | undefined> {
    const items: (QuickPickItem & { tenant: Tenant })[] = tenants.map((t) => ({
        label: `${t.name} (${t.id})`,
        tenant: t,
    }));
    const result = await window.showQuickPick(items, {
        placeHolder: "Select a tenant",
    });
    return result ? result.tenant : undefined;
}
