import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"]
});

export async function openaiHelper(error: any): Promise<string | null | undefined> {
  if (!error) {
    return;
  }
  let content = error;

  if (error?.error) {
    content = error?.error;
  }
  const response = await openai.chat.completions.create({ messages: [{ role: 'user', content: content }], model: 'gpt-3.5-turbo' }, {
    timeout: 30000,
  });
  console.log(response);
  return response.choices[0]?.message?.content || '';
}
