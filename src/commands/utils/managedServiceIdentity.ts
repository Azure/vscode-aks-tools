import {
    FederatedIdentityCredential,
    ManagedServiceIdentityClient,
    UserAssignedIdentitiesGetResponse,
} from "@azure/arm-msi";
import { Errorable, getErrorMessage } from "./errorable";

export async function getIdentity(
    client: ManagedServiceIdentityClient,
    resourceGroupName: string,
    resourceName: string,
): Promise<Errorable<UserAssignedIdentitiesGetResponse>> {
    try {
        const identity = await client.userAssignedIdentities.get(resourceGroupName, resourceName);
        if (!identity || !identity.principalId) {
            return { succeeded: false, error: "Identity does not have a principalId" };
        }
        return { succeeded: true, result: identity };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function createFederatedCredential(
    client: ManagedServiceIdentityClient,
    resourceGroupName: string,
    resourceName: string,
    federatedCredentialName: string,
    issuer: string,
    subject: string,
    audience: string,
): Promise<Errorable<void>> {
    try {
        const federatedCredential: FederatedIdentityCredential = {
            issuer: issuer,
            subject: subject,
            audiences: [audience],
        };
        await client.federatedIdentityCredentials.createOrUpdate(
            resourceGroupName,
            federatedCredentialName,
            resourceName,
            federatedCredential,
        );
        return { succeeded: true, result: undefined };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}
