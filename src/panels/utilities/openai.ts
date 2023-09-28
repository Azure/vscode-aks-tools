import { getOpenAIConfig, setOpenAIConfigApiKey } from "../../commands/utils/config";
import { failed, getErrorMessage, succeeded } from "../../commands/utils/errorable";
import { getOpenAIResult } from "../../commands/utils/helper/openaiHelper";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { AIKeyStatus, AIToVsCodeMsgDef, AIToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/shared";

export class OpenAIHelper {
    public config = getOpenAIConfig();
    public keyStatus = failed(this.config) ? AIKeyStatus.Missing : AIKeyStatus.Unverified;

    public getMessageHandler<TMsgDef extends AIToWebViewMsgDef>(webview: MessageSink<TMsgDef>): MessageHandler<AIToVsCodeMsgDef> {
        const aiWebview = webview as any as MessageSink<AIToWebViewMsgDef>;
        return {
            getAIKeyStatus: _args => this._handleGetAIKeyStatus(aiWebview),
            updateAIKeyRequest: args => this._handleUpdateAIKeyRequest(args.apiKey, aiWebview)
        };
    }

    public async runOpenAIRequest<TMsgDef extends AIToWebViewMsgDef>(prompt: string, webview: MessageSink<TMsgDef>): Promise<void> {
        const aiWebview = webview as any as MessageSink<AIToWebViewMsgDef>;
        if (failed(this.config)) {
            this._updateAIKeyStatus(AIKeyStatus.Missing, null, aiWebview);
            return;
        }

        const response = await getOpenAIResult(this.config.result, prompt);
        if (failed(response)) {
            this._updateAIKeyStatus(AIKeyStatus.Invalid, this.config.result.apiKey, aiWebview);
            return;
        }

        this._updateAIKeyStatus(AIKeyStatus.Valid, null, aiWebview);

        aiWebview.postMessage( {command: "startAIResponse", parameters: undefined });
        response.result.subscribe({
            next: chunk => aiWebview.postMessage({ command: "appendAIResponse", parameters: {chunk} }),
            error: err => aiWebview.postMessage({ command: "errorStreamingAIResponse", parameters: {error: getErrorMessage(err)} }),
            complete: () => aiWebview.postMessage({ command: "completeAIResponse", parameters: undefined })
        });
    }

    private _handleGetAIKeyStatus(webview: MessageSink<AIToWebViewMsgDef>) {
        const invalidKey = succeeded(this.config) && this.keyStatus === AIKeyStatus.Invalid ? this.config.result.apiKey : null;
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus: this.keyStatus, invalidKey} });
    }

    private async _handleUpdateAIKeyRequest(apiKey: string, webview: MessageSink<AIToWebViewMsgDef>) {
        await setOpenAIConfigApiKey(apiKey);
        this.config = getOpenAIConfig();
        this._updateAIKeyStatus(AIKeyStatus.Unverified, null, webview);
    }

    private _updateAIKeyStatus(keyStatus: AIKeyStatus, invalidKey: string | null, webview: MessageSink<AIToWebViewMsgDef>) {
        this.keyStatus = keyStatus;
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus, invalidKey} });
    }
}
