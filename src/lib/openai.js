import { OpenAIProvider, setTracingDisabled } from "@openai/agents";

// ✅ Disable tracing — stops SDK from calling api.openai.com
setTracingDisabled(true);

export const openrouter = new OpenAIProvider({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});