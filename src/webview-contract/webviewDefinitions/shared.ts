
export enum AIKeyStatus {
    Missing,
    Unverified,
    Invalid,
    Valid
}

export type AIToVsCodeMsgDef = {
    getAIKeyStatus: void,
    updateAIKeyRequest: {
        apiKey: string
    }
};

export type AIToWebViewMsgDef = {
    updateAIKeyStatus: {
        keyStatus: AIKeyStatus,
        invalidKey: string | null
    },
    startAIResponse: void,
    errorStreamingAIResponse: {
        error: string
    }
    appendAIResponse: {
        chunk: string
    },
    completeAIResponse: void
};
