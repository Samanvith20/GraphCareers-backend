import { chatService } from "../services/ai.services.js";
import logger from "../logger/logger.js";

export async function chatController(req, res) {
  const userId = req.userId;
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  // ✅ Create generator BEFORE flushing headers
  const stream = chatService(messages, userId);

  // ✅ Peek first value — rate limit / auth errors throw here
  // Headers not yet sent so we can return proper JSON error responses
  let firstChunk;
  try {
    const first = await stream.next();
    if (first.done) {
      return res.status(200).json({ message: "No response generated" });
    }
    firstChunk = first.value;
  } catch (err) {
    logger.error("[chatController] pre-stream error:", err.message);

    const status = err.statusCode ?? err.status ?? 500;
    return res.status(status).json({ error: err.message });
  }

  // ✅ Only flush headers after confirming no errors
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    // Write first chunk already consumed from the peek
    if (firstChunk) {
      res.write(`0:${JSON.stringify(firstChunk)}\n`);
    }

    // Stream the rest
    for await (const chunk of stream) {
      if (chunk) res.write(`0:${JSON.stringify(chunk)}\n`);
    }

    res.write(`d:${JSON.stringify({ finishReason: "stop" })}\n`);
    res.end();

  } catch (err) {
    logger.error("[chatController] streaming error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Agent failed" });
    } else {
      res.write(`3:${JSON.stringify({ error: err.message })}\n`);
      res.end();
    }
  }
}