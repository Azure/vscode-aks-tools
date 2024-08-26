import { Errorable, failed, getErrorMessage } from "./errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";

export function getCopilotClient(sessionProvider: ReadyAzureSessionProvider) {
    return new CopilotClient(sessionProvider);
}

type Config = {
    requestId: string;
    message: string;
    scenario: string;
    intent: string;
};

export interface CitationResponse {
    docs: Record<
        string,
        {
            title: string;
            description: string;
            url: string;
            id: string;
        }
    >;
    messageId: string;
}

export interface ChatResponse {
    id: string;
    text: string;
}

export class CopilotClient {
    private authToken: string;
    private tokenExpiresAt: number;
    private sessionProvider: ReadyAzureSessionProvider

    constructor(sessionProvider: ReadyAzureSessionProvider) {
        this.authToken = "";
        this.tokenExpiresAt = 0;
        this.sessionProvider  = sessionProvider
    }

    private async fetchToken() {
        try {
            let token2 = undefined;

            try {
                token2 = await this.sessionProvider.getAuthSession({scopes : ["https://management.core.windows.net/.default"]});
            } catch (err) {
                console.log("err", err);
            }
            if ((token2 && failed(token2))) {
                throw new Error(`No Microsoft authentication session found: ${token2.error}`);
            }
            this.authToken = token2!.result.accessToken;
        } catch (err) {
            // do nothing;
        }
    }

    protected async refreshToken() {
        if (!this.authToken || this.tokenExpiresAt < Date.now()) {
            await this.fetchToken();
        }
    }

    public async sendRequest(
        config: Config,
    ): Promise<Errorable<{ citation?: CitationResponse; messageId: string; response?: ChatResponse }>> {
        await this.refreshToken();

        const { intent, message, scenario, requestId } = config;

        let rawResponse = undefined;
        try {
            rawResponse = await fetch("https://pcnx-copilot-aqebbkc6frhyhkbx.z01.azurefd.net/aks-docs-rag-mid", {
                method: "POST",
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    Authorization: `Bearer ${this.authToken}`,
                    "App-Tenant-Id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
                },
                body: JSON.stringify({
                    IsLocalEvaluation: false,
                    Question: message,
                    Scenario: scenario,
                    Intent: intent,
                }),
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            return { succeeded: false, error: `Unable to fetch data from Azure Copilot: ${getErrorMessage(err)}` };
        }

        if (!rawResponse) {
            return { succeeded: false, error: `Unable to fetch data from Azure Copilot` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await rawResponse.json();
        const status = rawResponse.status;

        console.log("data", data);

        if (status === 424) {
            // 424 is a content moderation error
            throw new Error("424: Harmful content detected");
        } else if (status >= 400) {
            throw new Error("4XX: Unable to fetch data from Azure Copilot: ", data.message);
        }

        let citationResponse: CitationResponse | undefined  = undefined;
        let chatResponse : ChatResponse | undefined = undefined;

        if (data?.Citations) {
            citationResponse = {
                messageId: requestId,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                docs: Object.entries(data?.Citations).reduce((acc: any, entry: any) => {
                    const [idx, citation] = entry;
                    acc[idx] = {
                        title: citation[0],
                        url: citation[1].replace(/^https:\/(?!\/)/, "https://"),
                        description: citation[0],
                        id: idx.toString(),
                    };
                    return acc;
                }, {}),
            };
        }

        if (data?.Response) {
            // Properly format the response: remove trailing im_start tag and replace all tags like [\\[doc0\\]] with [doc0]
            const text = data?.Response.replace(/<\|im_start\|>(assistant\n|\n)/, "").replace(
                /\[\\\[doc(\d+)\\\]\]/g,
                "[doc$1]",
            );

            const response: ChatResponse = {
                id: requestId,
                text,
            };

            chatResponse = response;
        }

        return {
            succeeded: true,
            result: { citation: citationResponse, messageId: requestId, response: chatResponse },
        };
    }
}
