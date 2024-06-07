import { AuthenticationProvider, Client } from "@microsoft/microsoft-graph-client";
import { Errorable, getErrorMessage } from "./errorable";
import { GetAuthSessionOptions, ReadyAzureSessionProvider } from "../../auth/types";
import { getDefaultScope, getEnvironment } from "../../auth/azureAuth";

type GraphListResult<T> = {
    value: T[];
};

export type ServicePrincipal = {
    id: string;
    appId: string;
    displayName: string;
    tenantId: string;
};

export function createGraphClient(sessionProvider: ReadyAzureSessionProvider): Client {
    // The "Visual Studio Code" application (aebc6443-996d-45c2-90f0-388ff96faa56) does not have delegated
    // permission to call the Microsoft Graph endpoints required here. We need to use a different application ID.
    // TODO: This is the "Visual Studio" client ID. We should instead be using our own first party application.
    const applicationClientId = "04f0c124-f2bc-4f59-8241-bf6df9866bbd";

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
