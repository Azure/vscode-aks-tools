import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"]
});

export async function openaiHelper() {
  // Question: How can use kubectl? is placeholder for the user input.
  const teststream = await openai.chat.completions.create({ messages: [{ role: 'user', content: 'How can use kubectl?' }], model: 'gpt-3.5-turbo', stream: true }, {
    timeout: 5 * 1000,
  });

  for await (const part of teststream) {
    process.stdout.write(part.choices[0]?.delta?.content || '');
  }

  console.log(teststream);
}
