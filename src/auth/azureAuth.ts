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
import { Errorable, failed, getErrorMessage, map as errmap, succeeded, bindAsync } from "../commands/utils/errorable";
import { TokenCredential } from "@azure/core-auth";
import { parseJson } from "../commands/utils/json";
import { SubscriptionClient, TenantIdDescription } from "@azure/arm-resources-subscriptions";
import { listAll } from "../commands/utils/arm";

type AuthProviderId = "microsoft" | "microsoft-sovereign-cloud";

type Tenant = {
    name: string;
    id: string;
};

export type AzureAuthenticationSession = AuthenticationSession & {
    tenantId: string;
};

class AzureSessionProvider extends VsCodeDisposable {
    private readonly initializePromise: Promise<void>;
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

        const newSignInStatus = "SigningIn";
        if (newSignInStatus !== this.signInStatusValue) {
            this.signInStatusValue = newSignInStatus;
            this.onSignInStatusChangeEmitter.fire(this.signInStatusValue);
        }
        await this.signInAndUpdateTenants({ createIfNone: true, clearSessionPreference: true });
    }

    private async signInAndUpdateTenants(options: AuthenticationGetSessionOptions): Promise<void> {
        // Initially, try to get a session using the 'organizations' tenant/authority:
        // https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration#authority
        // This allows the user to sign in to the Microsoft provider and list tenants,
        // but the resulting session will not allow tenant-level operations. For that,
        // we need to get a session for a specific tenant.
        const getSessionResult = await getArmSession("organizations", options);
        const getTenantsResult = await bindAsync(getSessionResult, (session) => getTenants(session));
        this.tenants = succeeded(getTenantsResult) ? getTenantsResult.result : [];
        const newSignInStatus = this.tenants.length > 0 ? "SignedIn" : "SignedOut";
        if (newSignInStatus !== this.signInStatusValue) {
            this.signInStatusValue = newSignInStatus;
            this.onSignInStatusChangeEmitter.fire(this.signInStatusValue);
        }
    }

    public async getSession(): Promise<Errorable<AzureAuthenticationSession>> {
        await this.initializePromise;
        if (this.signInStatusValue !== "SignedIn") {
            return { succeeded: false, error: `Not signed in (${this.signInStatusValue}).` };
        }

        if (this.tenants.length === 0) {
            return { succeeded: false, error: "No tenants found." };
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

        // Get a session for a specific tenant.
        return await getArmSession(tenant.id, { createIfNone: true });
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

export function getAuthSession(): Promise<Errorable<AzureAuthenticationSession>> {
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
    // Endpoint URL is that of the audience, e.g. for ARM in the public cloud
    // it would be "https://management.core.windows.net".
    return endpointUrl.endsWith("/") ? `${endpointUrl}.default` : `${endpointUrl}/.default`;
}

/**
 * The type of a JSON-parsed JWT body. Right now we only make use of the 'exp' field,
 * but other standard claims could be added here if needed.
 */
interface Jwt {
    exp: number;
}

async function getArmSession(
    tenantId: string,
    options: AuthenticationGetSessionOptions,
): Promise<Errorable<AzureAuthenticationSession>> {
    try {
        const tenantScopes = tenantId ? [`VSCODE_TENANT:${tenantId}`] : [];
        const scopes = [getDefaultScope(getConfiguredAzureEnv().managementEndpointUrl), ...tenantScopes];

        const session = await authentication.getSession(getConfiguredAuthProviderId(), scopes, options);
        if (session) {
            return { succeeded: true, result: Object.assign(session, { tenantId }) };
        }

        return { succeeded: false, error: "No Azure session found." };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve Azure session: ${getErrorMessage(e)}` };
    }
}

function getConfiguredAuthProviderId(): AuthProviderId {
    return getConfiguredAzureEnv().name === Environment.AzureCloud.name ? "microsoft" : "microsoft-sovereign-cloud";
}

async function getTenants(session: AuthenticationSession): Promise<Errorable<Tenant[]>> {
    const armEndpoint = getConfiguredAzureEnv().resourceManagerEndpointUrl;
    const credential: TokenCredential = {
        getToken: async () => {
            return { token: session.accessToken, expiresOnTimestamp: 0 };
        },
    };
    const subscriptionClient = new SubscriptionClient(credential, { endpoint: armEndpoint });

    const tenantsResult = await listAll(subscriptionClient.tenants.list());
    return errmap(tenantsResult, (t) => t.filter(asTenant).map((t) => ({ name: t.displayName, id: t.tenantId })));
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
