import { chatService } from "../services/ai.services.js";

export async function chatController(req, res) {
  const userId = req.userId;
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    let wroteAnything = false;

    // ✅ chatService is now an async generator — iterate and stream
    for await (const chunk of chatService(messages, userId)) {
      if (chunk && chunk.trim()) {
        res.write(`0:${JSON.stringify(chunk)}\n`);
        wroteAnything = true;
      }
    }

    // Safety fallback if nothing was streamed
    if (!wroteAnything) {
      res.write(`0:${JSON.stringify("I'm here to help with your career. What would you like to know?")}\n`);
    }

    res.write(`d:${JSON.stringify({ finishReason: "stop" })}\n`);
    res.end();

  } catch (err) {
    console.error("[chatController] error:", err.message);
    console.error("[chatController] stack:", err.stack);

    if (!res.headersSent) {
      res.status(500).json({ error: "Agent failed" });
    } else {
      res.write(`3:${JSON.stringify({ error: err.message })}\n`);
      res.end();
    }
  }
}