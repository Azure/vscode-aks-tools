import { ReadyAzureSessionProvider } from "../../../auth/types";
import { Errorable, failed, getErrorMessage } from "../../../commands/utils/errorable";
import { aksDocsRAGEndpoint, aksDocsRAGIntent, aksDocsRAGScenario, aksDocsRAGScopes } from "./constants";

export function getAKSDocsRAGClient(sessionProvider: ReadyAzureSessionProvider) {
    return new AKSDocsRAGClient(sessionProvider);
}

type RequestConfig = {
    message: string;
};

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

    private async fetchToken() {
        const token = await this.sessionProvider.getAuthSession({ scopes: this.authScopes });

        if ((!token || failed(token))) {
            throw new Error(`No Microsoft authentication session found: ${token.error}`);
        }

        this.authToken = token.result.accessToken;
    }

    protected async refreshToken() {
        if (!this.authToken || this.tokenExpiresAt < Date.now()) {
            await this.fetchToken();
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await rawResponse.json();
        const status = rawResponse.status;

        if (status === 424) {
            // 424 is a content moderation error
            return { succeeded: false, error: `Error 424: Harmful content detected` }
        } else if (status >= 400) {
            return { succeeded: false, error: `Error: ${data.message}` }
        }

        const commandResponse: CommandResponse = {
            status: "",
            message: "",
            code: "",
        };
        
        if (data?.Response) {
            const response = data.Response as string // JSON response
            const parsedResponse = JSON.parse(response) as CommandResponse;

            if(parsedResponse.status === "error") {
                return { succeeded: false, error: parsedResponse.message };
            }

            commandResponse.code = parsedResponse.code;
            commandResponse.message = parsedResponse.message;
            commandResponse.status = parsedResponse.status;

        } else {
            return { succeeded: false, error: `Error: Unable to get response` };
        }

        return {
            succeeded: true,
            result: { response: commandResponse },
        };
    }
}