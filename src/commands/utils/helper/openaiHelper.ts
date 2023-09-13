import OpenAI from 'openai';
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat';
import {failed} from '../errorable';
import { getOpenAIConfig } from '../config';
import * as vscode from 'vscode';

export async function openaiHelper(error: string): Promise<string> {
    const body: ChatCompletionCreateParamsNonStreaming = {
        messages: [{ role: 'user', content: error }],
        model: 'gpt-3.5-turbo'
    };

    const openaiConfig = getOpenAIConfig();
  
    if (failed(openaiConfig)) {
      vscode.window.showInformationMessage(openaiConfig.error);
      console.log(openaiConfig.error);
      return ''
    } 

    const openai = new OpenAI({
      apiKey: openaiConfig.result.apiKey
    });

    const options = { timeout: 30000 };
    const response = await openai.chat.completions.create(body, options);

    return response.choices[0]?.message?.content || '';
}
