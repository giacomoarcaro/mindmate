import OpenAI from 'openai';
import systemPrompt from '../../gpt/system-prompt.json';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const generateResponse = async (message, userData) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: systemPrompt.content
        },
        {
          role: "user",
          content: `User: ${userData.name}, Age: ${userData.age}, Concerns: ${userData.concerns}, Goals: ${userData.goals}, Preferences: ${userData.preferences}\n\nMessage: ${message}`
        }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating GPT response:', error);
    throw error;
  }
}; 