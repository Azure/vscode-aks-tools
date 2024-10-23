import { AuthenticationSession, Event } from "vscode";
import { Errorable } from "../commands/utils/errorable";

export type SignInStatus = "Initializing" | "SigningIn" | "SignedIn" | "SignedOut";

export type TokenInfo = {
    token: string;
    expiry: Date;
};

export type AzureAuthenticationSession = AuthenticationSession & {
    tenantId: string;
};

export type Tenant = {
    name: string;
    id: string;
    countryCode?: string;
};

export type GetAuthSessionOptions = {
    applicationClientId?: string;
    scopes?: string[];
};

export type AzureSessionProvider = {
    signIn(): Promise<void>;
    signInStatus: SignInStatus;
    availableTenants: Tenant[];
    selectedTenant: Tenant | null;
    signInStatusChangeEvent: Event<SignInStatus>;
    getAuthSession(options?: GetAuthSessionOptions): Promise<Errorable<AzureAuthenticationSession>>;
    dispose(): void;
};

export type ReadyAzureSessionProvider = AzureSessionProvider & {
    signInStatus: "SignedIn";
    selectedTenant: Tenant;
};

export function isReady(provider: AzureSessionProvider): provider is ReadyAzureSessionProvider {
    return provider.signInStatus === "SignedIn" && provider.selectedTenant !== null;
}
