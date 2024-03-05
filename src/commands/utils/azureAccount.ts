import { Subscription } from "@azure/arm-subscriptions";
import { TokenCredential } from "@azure/core-auth";
import { combine, Errorable, failed, getErrorMessage, succeeded } from "./errorable";
import { ClientSecretCredential } from "@azure/identity";
import "cross-fetch/polyfill"; // Needed by the graph client: https://github.com/microsoftgraph/msgraph-sdk-javascript/blob/dev/README.md#via-npm
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import {
    TokenCredentialAuthenticationProvider,
    TokenCredentialAuthenticationProviderOptions,
} from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { RoleAssignment } from "@azure/arm-authorization";
import { getConfiguredAzureEnv } from "@microsoft/vscode-azext-azureauth";
import { getSubscriptions, getTenantIds } from "./azureSession";

function getDefaultScope(endpointUrl: string): string {
    return endpointUrl.endsWith("/") ? `${endpointUrl}.default` : `${endpointUrl}/.default`;
}

export interface ServicePrincipalAccess {
    readonly cloudName: string;
    readonly tenantId: string;
    readonly subscriptions: {
        readonly id: string;
        readonly name: string;
    }[];
}

interface SubscriptionAccessResult {
    readonly subscription: Subscription;
    readonly hasRoleAssignment: boolean;
}

interface ServicePrincipalInfo {
    readonly id: string;
    readonly displayName: string;
    readonly credential: TokenCredential;
    readonly tenantId: string;
}

export async function getServicePrincipalAccess(
    appId: string,
    secret: string,
): Promise<Errorable<ServicePrincipalAccess>> {
    const spInfo = await getServicePrincipalInfo(appId, secret);
    if (failed(spInfo)) {
        return spInfo;
    }

    const cloudName = getConfiguredAzureEnv().name;
    const filteredSubscriptions = await getSubscriptions(true);
    if (failed(filteredSubscriptions)) {
        return filteredSubscriptions;
    }

    const promiseResults = await Promise.all(
        filteredSubscriptions.result.map((s) => getSubscriptionAccess(spInfo.result.credential, s, spInfo.result)),
    );

    const ownershipResults = combine(promiseResults);
    if (failed(ownershipResults)) {
        return ownershipResults;
    }

    const subscriptions = ownershipResults.result
        .filter((r) => r.hasRoleAssignment)
        .map((r) => ({
            id: r.subscription.subscriptionId || "",
            name: r.subscription.displayName || "",
        }));

    return { succeeded: true, result: { cloudName, tenantId: spInfo.result.tenantId, subscriptions } };
}

async function getServicePrincipalInfo(appId: string, appSecret: string): Promise<Errorable<ServicePrincipalInfo>> {
    const tenantIds = await getTenantIds();
    if (failed(tenantIds)) {
        return tenantIds;
    }

    const spInfoResults = await Promise.all(
        tenantIds.result.map((id) => getServicePrincipalInfoForTenant(id, appId, appSecret)),
    );
    for (const spInfoResult of spInfoResults) {
        if (succeeded(spInfoResult)) {
            return spInfoResult;
        }
    }

    const spInfosResult = combine(spInfoResults);
    if (succeeded(spInfosResult)) {
        // Can only happen if there were no sessions, otherwise we would've returned success above.
        return { succeeded: false, error: "No Azure sessions found." };
    }

    return spInfosResult;
}

type ServicePrincipalSearchResult = {
    value?: {
        id: string;
        displayName: string;
    }[];
};

async function getServicePrincipalInfoForTenant(
    tenantId: string,
    appId: string,
    appSecret: string,
): Promise<Errorable<ServicePrincipalInfo>> {
    // Use the MS Graph API to retrieve the object ID and display name of the service principal,
    // using its own password as the credential.
    const baseUrl = getMicrosoftGraphClientBaseUrl();
    const graphClientOptions: TokenCredentialAuthenticationProviderOptions = {
        scopes: [getDefaultScope(baseUrl)],
    };

    const credential = new ClientSecretCredential(tenantId, appId, appSecret);

    const graphClient = GraphClient.initWithMiddleware({
        baseUrl,
        authProvider: new TokenCredentialAuthenticationProvider(credential, graphClientOptions),
    });

    let spSearchResults: ServicePrincipalSearchResult;
    try {
        spSearchResults = await graphClient
            .api("/servicePrincipals")
            .filter(`appId eq '${appId}'`)
            .select(["id", "displayName"])
            .get();
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve service principal: ${getErrorMessage(e)}` };
    }

    if (!spSearchResults.value || spSearchResults.value.length !== 1) {
        return {
            succeeded: false,
            error: `Expected service principal search result to contain value with one item. Actual result: ${JSON.stringify(
                spSearchResults,
            )}`,
        };
    }

    const searchResult = spSearchResults.value[0];
    const spInfo = {
        id: searchResult.id,
        displayName: searchResult.displayName,
        credential,
        tenantId,
    };

    return { succeeded: true, result: spInfo };
}

function getMicrosoftGraphClientBaseUrl(): string {
    const environment = getConfiguredAzureEnv();
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

async function getSubscriptionAccess(
    credential: TokenCredential,
    subscription: Subscription,
    spInfo: ServicePrincipalInfo,
): Promise<Errorable<SubscriptionAccessResult>> {
    if (!subscription.subscriptionId) {
        return { succeeded: true, result: { subscription, hasRoleAssignment: false } };
    }

    const client = new AuthorizationManagementClient(credential, subscription.subscriptionId);
    const roleAssignments: RoleAssignment[] = [];
    try {
        const iterator = client.roleAssignments.listForSubscription({ filter: `principalId eq '${spInfo.id}'` });
        for await (const pageRoleAssignments of iterator.byPage()) {
            roleAssignments.push(...pageRoleAssignments);
        }
    } catch (e) {
        if (isUnauthorizedError(e)) {
            return { succeeded: true, result: { subscription, hasRoleAssignment: false } };
        }

        return { succeeded: false, error: getErrorMessage(e) };
    }

    // The service principal needs *some* permissions in the subscription, but Contributor is not
    // necessarily required. See: https://azure.github.io/azure-service-operator/#installation
    return { succeeded: true, result: { subscription, hasRoleAssignment: roleAssignments.length > 0 } };
}

function isUnauthorizedError(e: unknown): boolean {
    return (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        "statusCode" in e &&
        e.code === "AuthorizationFailed" &&
        e.statusCode === 403
    );
}
