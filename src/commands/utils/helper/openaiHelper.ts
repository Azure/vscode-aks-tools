import OpenAI from 'openai';
import { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';
import { Errorable, getErrorMessage } from '../errorable';
import { Observable, filter, from, map } from 'rxjs';
import { Stream } from 'openai/streaming';
import { OpenAIConfig } from './openaiConfig';

export async function getOpenAIResult(config: OpenAIConfig, message: string): Promise<Errorable<Observable<string>>> {
    const openai = new OpenAI({
        apiKey: config.apiKey
    });

    const body: ChatCompletionCreateParamsStreaming = {
        messages: [{ role: 'user', content: message }],
        model: 'gpt-3.5-turbo',
        stream: true
    };

    const options = { timeout: 30000 };
    let responseStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
        responseStream = await openai.chat.completions.create(body, options);
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }

    const response = from(responseStream).pipe(
        map(chunk => chunk.choices[0].delta?.content || null),
        filter(s => s !== null)) as Observable<string>; // Cast is safe because we're filtering out nulls.

    return {
        succeeded: true,
        result: response
    };
}
