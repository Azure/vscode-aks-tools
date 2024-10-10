import { ReadyAzureSessionProvider } from "../../../auth/types";
import { Errorable, failed, getErrorMessage } from "../../../commands/utils/errorable";
import { aksDocsRAGEndpoint, aksDocsRAGIntent, aksDocsRAGScenario, aksDocsRAGScopes } from "./constants";

export function getAKSDocsRAGClient(sessionProvider: ReadyAzureSessionProvider) {
    return new AKSDocsRAGClient(sessionProvider);
}

type RequestConfig = {
    message: string;
};

interface DataResponse {
    Response: string; // JSON string
}

export interface CommandResponse {
    status: string;
    message: string;
    code: string;
}

export class AKSDocsRAGClient {
    private authToken: string;
    private tokenExpiresAt: number;
    private sessionProvider: ReadyAzureSessionProvider;
    private authScopes: string[];

    constructor(sessionProvider: ReadyAzureSessionProvider) {
        this.authToken = "";
        this.tokenExpiresAt = 0;
        this.sessionProvider = sessionProvider
        this.authScopes = aksDocsRAGScopes;
    }

    private async fetchToken(): Promise<void> {
        try {
            const token = await this.sessionProvider.getAuthSession({ scopes: this.authScopes });

            if (failed(token)) {
                throw new Error(`No Microsoft authentication session found: ${token?.error}`);
            }

            this.authToken = token.result.accessToken;
        } catch (error) {
            throw new Error(`Failed to fetch token: ${getErrorMessage(error)}`);
        }
    }

    private async refreshToken(): Promise<void> {
        try {
            if (!this.authToken || this.tokenExpiresAt < Date.now()) {
                await this.fetchToken();
            }
        } catch (error) {
            throw new Error(`Failed to refresh token: ${getErrorMessage(error)}`);
        }
    }

    public async sendRequest(config: RequestConfig): Promise<Errorable<{ response: CommandResponse }>> {
        await this.refreshToken();
        const { message } = config;

        let rawResponse = undefined;
        try {
            rawResponse = await fetch(aksDocsRAGEndpoint, {
                method: "POST",
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    Authorization: `Bearer ${this.authToken}`,
                    "App-Tenant-Id": this.sessionProvider.selectedTenant.id,
                },
                body: JSON.stringify({
                    IsLocalEvaluation: false,
                    Question: message,
                    Scenario: aksDocsRAGScenario,
                    Intent: aksDocsRAGIntent,
                }),
            });
        } catch (err: unknown) {
            return { succeeded: false, error: `Unable to fetch data from AKS Docs RAG endpoint: ${getErrorMessage(err)}` };
        }

        if (!rawResponse) {
            return { succeeded: false, error: `Unable to fetch data from AKS Docs RAG endpoint` };
        }

        const statusCode = rawResponse.status;
        const data = await rawResponse.json() as DataResponse;

        // 424 error code is returned when harmful content is detected
        if (statusCode === 424) {
            return { succeeded: false, error: "Error 424: Harmful content detected" };
        } else if (statusCode >= 400) {
            return { succeeded: false, error: `Error: ${rawResponse.statusText}` };
        }

        // Process successful response
        const responseData = data?.Response;

        if (!responseData) {
            return { succeeded: false, error: "Error: Unable to get response" };
        }

        const parsedResponse = JSON.parse(responseData) as CommandResponse;
        if (parsedResponse.status.toLowerCase() === "error") {
            return { succeeded: false, error: parsedResponse.message };
        }

        return {
            succeeded: true,
            result: { response: parsedResponse },
        };
    }
}