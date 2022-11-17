import { AuthenticationResult, Configuration, PublicClientApplication, RefreshTokenRequest } from "@azure/msal-node";
import { Cloud } from "./clouds";
import { Errorable } from "./errorable";

// The AppId (ClientId) of VS Code
// https://github.com/Azure/azure-sdk-for-js/blob/5eb19b911388ec4ba830e36934bdb4840ec7977d/sdk/identity/identity/src/credentials/visualStudioCodeCredential.ts#L21
const AzureAccountClientId = "aebc6443-996d-45c2-90f0-388ff96faa56";

export async function getAksAadAccessToken(cloud: Cloud, serverId: string, refreshToken: string): Promise<Errorable<AuthenticationResult>> {
    // The MSAL configuration is for the current application (i.e. VS Code),
    // even though we will be requesting a token for a different application.
    const clientConfig: Configuration = {
        auth: {
            clientId: AzureAccountClientId,
            authority: `${cloud.aadEndpoint}/72f988bf-86f1-41af-91ab-2d7cd011db47`,
        }
    };
    
    const application = new PublicClientApplication(clientConfig);

    // The token needs to have an 'audience' claim whose value matches the 'serverId' value (i.e. the AKS AAD server).
    // We request that by specifying the serverId value in the scope. See: https://stackoverflow.com/a/67737375
    const request: RefreshTokenRequest = {
        scopes: [`${serverId}/.default`],
        refreshToken
    }

    const tokenResponse = await application.acquireTokenByRefreshToken(request);
    if (!tokenResponse) {
        return { succeeded: false, error: `Unable to acquire AAD token for server ${serverId} from refresh token.` };
    }

    return { succeeded: true, result: tokenResponse };
}