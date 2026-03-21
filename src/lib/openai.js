import { createOpenAI } from "@ai-sdk/openai";
import { OpenAI } from "openai/client.js";



export const openrouter = createOpenAI({
apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});


export const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENROUTER_API_KEY,
});