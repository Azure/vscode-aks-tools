import { AuthenticationProvider, Client } from "@microsoft/microsoft-graph-client";
import { Errorable, getErrorMessage } from "./errorable";
import { getDefaultScope, getEnvironment } from "../../auth/azureAuth";
import { GetAuthSessionOptions, ReadyAzureSessionProvider } from "../../auth/types";

const federatedIdentityCredentialIssuer = "https://token.actions.githubusercontent.com";
const federatedIdentityCredentialAudience = "api://AzureADTokenExchange";

type GraphListResult<T> = {
    value: T[];
};

export type ApplicationParams = {
    displayName: string;
};

export type Application = ApplicationParams & {
    appId: string;
    id: string;
};

export type ServicePrincipalParams = {
    appId: string;
    displayName?: string;
};

export type ServicePrincipal = ServicePrincipalParams & {
    id: string;
    displayName: string;
};

export type FederatedIdentityCredentialParams = {
    name: string;
    subject: string;
    issuer: string;
    description: string;
    audiences: string[];
};

export type FederatedIdentityCredential = FederatedIdentityCredentialParams & {
    id: string;
};

export function createGraphClient(sessionProvider: ReadyAzureSessionProvider): Client {
    // The "Visual Studio Code" application id.
    // ClientID seen on auth login for azure sign-in on vscode.
    // Referenced here in azure identity source code: https://github.com/Azure/azure-sdk-for-net/blob/bba9347edf324ec3731cb31d5600fd379a76a20c/sdk/identity/Azure.Identity/src/Credentials/VisualStudioCodeCredential.cs#L29
    const applicationClientId = "aebc6443-996d-45c2-90f0-388ff96faa56";

    const baseUrl = getMicrosoftGraphClientBaseUrl();
    const authProvider: AuthenticationProvider = {
        getAccessToken: async (options) => {
            const authSessionOptions: GetAuthSessionOptions = {
                scopes: options?.scopes || [getDefaultScope(baseUrl)],
                applicationClientId,
            };

            const session = await sessionProvider.getAuthSession(authSessionOptions);
            return session.succeeded ? session.result.accessToken : "";
        },
    };

    return Client.initWithMiddleware({ baseUrl, authProvider });
}

function getMicrosoftGraphClientBaseUrl(): string {
    const environment = getEnvironment();
    // Environments are from here: https://github.com/Azure/ms-rest-azure-env/blob/6fa17ce7f36741af6ce64461735e6c7c0125f0ed/lib/azureEnvironment.ts#L266-L346
    // They do not contain the MS Graph endpoints, whose values are here:
    // https://github.com/microsoftgraph/msgraph-sdk-javascript/blob/d365ab1d68f90f2c38c67a5a7c7fe54acfc2584e/src/Constants.ts#L28
    switch (environment.name) {
        case "AzureChinaCloud":
            return "https://microsoftgraph.chinacloudapi.cn";
        case "AzureUSGovernment":
            return "https://graph.microsoft.us";
        case "AzureGermanCloud":
            return "https://graph.microsoft.de";
    }
    return "https://graph.microsoft.com";
}

export async function getCurrentUserId(graphClient: Client): Promise<Errorable<string>> {
    try {
        const me = await graphClient.api("/me").get();
        return { succeeded: true, result: me.id };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function getOwnedApplications(graphClient: Client): Promise<Errorable<Application[]>> {
    try {
        const appSearchResults: GraphListResult<Application> = await graphClient
            .api("/me/ownedObjects/microsoft.graph.application")
            .select(["id", "appId", "displayName"])
            .get();

        return { succeeded: true, result: appSearchResults.value };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function createApplication(graphClient: Client, applicationName: string): Promise<Errorable<Application>> {
    const newApp: ApplicationParams = {
        displayName: applicationName,
    };

    try {
        const application: Application = await graphClient.api("/applications").post(newApp);

        return { succeeded: true, result: application };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function deleteApplication(graphClient: Client, applicationObjectId: string): Promise<Errorable<void>> {
    try {
        await graphClient.api(`/applications/${applicationObjectId}`).delete();
        return { succeeded: true, result: undefined };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function createServicePrincipal(
    graphClient: Client,
    applicationId: string,
): Promise<Errorable<ServicePrincipal>> {
    const newServicePrincipal: ServicePrincipalParams = {
        appId: applicationId,
    };

    try {
        const servicePrincipal: ServicePrincipal = await graphClient
            .api("/servicePrincipals")
            .post(newServicePrincipal);
        return { succeeded: true, result: servicePrincipal };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function getServicePrincipalsForApp(
    graphClient: Client,
    appId: string,
): Promise<Errorable<ServicePrincipal[]>> {
    try {
        const spSearchResults: GraphListResult<ServicePrincipal> = await graphClient
            .api("/servicePrincipals")
            .filter(`appId eq '${appId}'`)
            .get();

        return { succeeded: true, result: spSearchResults.value };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function getFederatedIdentityCredentials(
    graphClient: Client,
    applicationId: string,
): Promise<Errorable<FederatedIdentityCredential[]>> {
    try {
        const identityResults: GraphListResult<FederatedIdentityCredential> = await graphClient
            .api(`/applications/${applicationId}/federatedIdentityCredentials`)
            .get();

        return { succeeded: true, result: identityResults.value };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function createFederatedIdentityCredential(
    graphClient: Client,
    applicationId: string,
    subject: string,
    name: string,
    description: string,
): Promise<Errorable<FederatedIdentityCredential>> {
    const newCred: FederatedIdentityCredentialParams = {
        name,
        subject,
        issuer: federatedIdentityCredentialIssuer,
        description,
        audiences: [federatedIdentityCredentialAudience],
    };

    try {
        const cred: FederatedIdentityCredential = await graphClient
            .api(`/applications/${applicationId}/federatedIdentityCredentials`)
            .post(newCred);

        return { succeeded: true, result: cred };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
} ////////TODO: catch fail logic if the same cred already exists

export async function createGitHubActionFederatedIdentityCredential(
    graphClient: Client,
    applicationId: string,
    organization: string,
    repository: string,
    branch: string,
): Promise<Errorable<FederatedIdentityCredential>> {
    const subject = `repo:${organization}/${repository}:ref:refs/heads/${branch}`;
    return createFederatedIdentityCredential(graphClient, applicationId, subject, "gitHub_actions", "");
}

export async function deleteFederatedIdentityCredential(
    graphClient: Client,
    applicationId: string,
    credId: string,
): Promise<Errorable<void>> {
    try {
        await graphClient.api(`/applications/${applicationId}/federatedIdentityCredentials/${credId}`).delete();
        return { succeeded: true, result: undefined };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export function findFederatedIdentityCredential(
    subject: string,
    creds: FederatedIdentityCredential[],
): FederatedIdentityCredential | undefined {
    return creds.find((c) => c.subject === subject && c.issuer === federatedIdentityCredentialIssuer);
}
