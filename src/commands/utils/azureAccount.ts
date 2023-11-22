import * as vscode from "vscode";
import { Subscription } from "@azure/arm-subscriptions";
import { Environment } from "@azure/ms-rest-azure-env";
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
import { RoleAssignmentsListResponse } from "@azure/arm-authorization/esm/models";
import { isObject } from "./runtimeTypes";

export interface AzureAccountExtensionApi {
    readonly filters: AzureResourceFilter[];
    readonly sessions: AzureSession[];
    readonly subscriptions: AzureSubscription[];
}

export interface AzureResourceFilter {
    readonly session: AzureSession;
    readonly subscription: Subscription;
}

export interface AzureSession {
    readonly environment: Environment;
    readonly userId: string;
    readonly tenantId: string;
    readonly credentials2?: TokenCredential;
}

export interface AzureSubscription {
    readonly session: AzureSession;
    readonly subscription: Subscription;
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
    readonly session: AzureSession;
    readonly credential: TokenCredential;
}

export function getAzureAccountExtensionApi(): Errorable<AzureAccountExtensionApi> {
    const azureAccountExtension = vscode.extensions.getExtension("ms-vscode.azure-account");
    if (!azureAccountExtension) {
        return { succeeded: false, error: "Azure extension not found." };
    }

    return { succeeded: true, result: azureAccountExtension.exports.api };
}

export async function getServicePrincipalAccess(
    apiAzureAccount: AzureAccountExtensionApi,
    appId: string,
    secret: string,
): Promise<Errorable<ServicePrincipalAccess>> {
    const spInfo = await getServicePrincipalInfo(apiAzureAccount.sessions, appId, secret);
    if (failed(spInfo)) {
        return spInfo;
    }

    const cloudName = spInfo.result.session.environment.name;
    const tenantId = spInfo.result.session.tenantId;
    const promiseResults = await Promise.all(
        apiAzureAccount.filters.map((f) =>
            getSubscriptionAccess(spInfo.result.credential, f.subscription, spInfo.result),
        ),
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

    return { succeeded: true, result: { cloudName, tenantId, subscriptions } };
}

async function getServicePrincipalInfo(
    sessions: AzureSession[],
    appId: string,
    appSecret: string,
): Promise<Errorable<ServicePrincipalInfo>> {
    const spInfoResults = await Promise.all(
        sessions.map((s) => getServicePrincipalInfoForSession(s, appId, appSecret)),
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

async function getServicePrincipalInfoForSession(
    session: AzureSession,
    appId: string,
    appSecret: string,
): Promise<Errorable<ServicePrincipalInfo>> {
    // Use the MS Graph API to retrieve the object ID and display name of the service principal,
    // using its own password as the credential.
    const baseUrl = getMicrosoftGraphClientBaseUrl(session.environment);
    const graphClientOptions: TokenCredentialAuthenticationProviderOptions = {
        scopes: [`${baseUrl}/.default`],
    };

    const credential = new ClientSecretCredential(session.tenantId, appId, appSecret);

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
        session,
        credential,
    };

    return { succeeded: true, result: spInfo };
}

function getMicrosoftGraphClientBaseUrl(environment: Environment): string {
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
    let roleAssignments: RoleAssignmentsListResponse;
    try {
        roleAssignments = await client.roleAssignments.list({ filter: `principalId eq '${spInfo.id}'` });
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
    return isObject(e) && "code" in e && "statusCode" in e && e.code === "AuthorizationFailed" && e.statusCode === 403;
}
