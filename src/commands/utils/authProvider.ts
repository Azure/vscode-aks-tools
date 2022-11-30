import { Environment } from "@azure/ms-rest-azure-env";
import { AuthenticationResult, Configuration, PublicClientApplication, RefreshTokenRequest } from "@azure/msal-node";
import { URL } from "url";
import { Errorable } from "./errorable";

// The AppId (ClientId) of VS Code
// https://github.com/Azure/azure-sdk-for-js/blob/5eb19b911388ec4ba830e36934bdb4840ec7977d/sdk/identity/identity/src/credentials/visualStudioCodeCredential.ts#L21
const AzureAccountClientId = "aebc6443-996d-45c2-90f0-388ff96faa56";

export async function getAksAadAccessToken(environment: Environment, serverId: string, tenantId: string, refreshToken: string): Promise<Errorable<AuthenticationResult>> {
    // The MSAL configuration is for the current application (i.e. VS Code),
    // even though we will be requesting a token for a different application.
    const clientConfig: Configuration = {
        auth: {
            clientId: AzureAccountClientId,
            authority: new URL(tenantId, environment.activeDirectoryEndpointUrl).href
        }
    };
    
    const application = new PublicClientApplication(clientConfig);

    // The token needs to have an 'audience' claim whose value matches the 'serverId' value (i.e. the AKS AAD server).
    // We request that by specifying the serverId value in the scope. See: https://stackoverflow.com/a/67737375
    const request: RefreshTokenRequest = {
        scopes: [`${serverId}/.default`],
        refreshToken
    }

    // According to the MSAL docs, this method is intended for use in migration from an older AD API (ADAL),
    // and the recommended alternative is to use `acquireTokenSilent`:
    // https://learn.microsoft.com/en-us/azure/active-directory/develop/msal-node-migration
    // https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/f318796c278e39153e8cd9bf3ce03259cb80c8a6/lib/msal-node/src/client/ClientApplication.ts#L172-L178
    // However, there's no obvious way to use `acquireTokenSilent`, since it relies on a TokenCache structure
    // (to retrieve the refresh token) that's very specific to MSAL, and not available to us here.
    let tokenResponse: AuthenticationResult | null;
    try {
        tokenResponse = await application.acquireTokenByRefreshToken(request);
    } catch (e) {
        return { succeeded: false, error: `Failed to acquire AAD token for server ${serverId} from refresh token:\n${e}` };
    }

    if (!tokenResponse) {
        return { succeeded: false, error: `Unable to acquire AAD token for server ${serverId} from refresh token.` };
    }

    return { succeeded: true, result: tokenResponse };
}