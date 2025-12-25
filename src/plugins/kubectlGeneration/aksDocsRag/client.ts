import { ReadyAzureSessionProvider } from "../../../auth/types";
import { Errorable, failed, getErrorMessage } from "../../../commands/utils/errorable";
import { aksDocsRAGEndpoint, aksDocsRAGIntent, aksDocsRAGScenario, aksDocsRAGScopes, EU_COUNTRIES } from "./constants";

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
        this.sessionProvider = sessionProvider;
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
                    "User-Data-Boundary": this.isEUBoundary(this.sessionProvider.selectedTenant.countryCode)
                        ? "EU"
                        : "Global",
                },
                body: JSON.stringify({
                    IsLocalEvaluation: false,
                    Question: message,
                    Scenario: aksDocsRAGScenario,
                    Intent: aksDocsRAGIntent,
                }),
            });
        } catch (err: unknown) {
            return {
                succeeded: false,
                error: `Unable to fetch data from AKS Docs RAG endpoint: ${getErrorMessage(err)}`,
            };
        }

        if (!rawResponse) {
            return { succeeded: false, error: `Unable to fetch data from AKS Docs RAG endpoint` };
        }

        const statusCode = rawResponse?.status ?? 0; // Use a default value for statusCode
        let data: DataResponse;
        try {
            data = (await rawResponse.json()) as DataResponse;
        } catch (error) {
            return {
                succeeded: false,
                error: `Failed to parse JSON response from AKS Docs RAG endpoint: ${getErrorMessage(error)}`,
            };
        }

        // Handle various error scenarios based on status code and response data
        switch (statusCode) {
            case 424:
                return { succeeded: false, error: "Error 424: Harmful content detected from RAGS endpoint" };
            case 0:
                return { succeeded: false, error: "Error: Invalid status code received from RAGS endpoint" };
            default:
                if (statusCode >= 400) {
                    return {
                        succeeded: false,
                        error: `Error ${statusCode}: ${rawResponse.statusText} from RAGS endpoint`,
                    };
                } else if (!data) {
                    return { succeeded: false, error: "Error: No response data received from RAGS endpoint" };
                }
                break;
        }

        // Process successful response
        const responseData = data?.Response;

        const parsedResponse = JSON.parse(responseData) as CommandResponse;
        if (parsedResponse.status.toLowerCase() === "error") {
            return { succeeded: false, error: parsedResponse.message };
        }

        return {
            succeeded: true,
            result: { response: parsedResponse },
        };
    }

    private isEUBoundary(countryCode: string | undefined): boolean {
        if (countryCode === undefined) {
            // Default to EU data boundary if country code is not available, an iterim solution to ensure compliance with EU data protection regulations.
            return true;
        }
        return EU_COUNTRIES.includes(countryCode);
    }
}
