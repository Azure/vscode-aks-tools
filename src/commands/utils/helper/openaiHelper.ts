import OpenAI from 'openai';
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat';

const openai = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"]
});

export async function openaiHelper(error: string): Promise<string> {
    const body: ChatCompletionCreateParamsNonStreaming = {
        messages: [{ role: 'user', content: error }],
        model: 'gpt-3.5-turbo'
    };

    const options = { timeout: 30000 };
    const response = await openai.chat.completions.create(body, options);

    return response.choices[0]?.message?.content || '';
}
