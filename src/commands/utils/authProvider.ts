import { AuthenticationResult, Configuration, PublicClientApplication, RefreshTokenRequest } from "@azure/msal-node";
import { Cloud } from "./clouds";
import { Errorable } from "./errorable";

// The AppId (ClientId) of VS Code
// https://github.com/Azure/azure-sdk-for-js/blob/5eb19b911388ec4ba830e36934bdb4840ec7977d/sdk/identity/identity/src/credentials/visualStudioCodeCredential.ts#L21
const AzureAccountClientId = "aebc6443-996d-45c2-90f0-388ff96faa56";

export async function getAksAadAccessToken(cloud: Cloud, serverId: string, refreshToken: string, ): Promise<Errorable<AuthenticationResult>> {
    const clientConfig: Configuration = {
        auth: {
            clientId: AzureAccountClientId,
            authority: "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47",
        }
    };
    
    const application = new PublicClientApplication(clientConfig);
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