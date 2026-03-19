import axios from "axios";

export async function rewriteQuery(query) {
  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
            Rewrite the user query ONLY if necessary.

Rules:
- DO NOT change the meaning
- DO NOT convert greetings into career questions
- If the query is already clear → return it AS IS
- Preserve intent exactly
            `,
          },
          { role: "user", content: query },
        ],
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      }
    );
    return res.data.choices[0].message.content?.trim() || query;
  } catch {
    return query; // safe fallback
  }
}