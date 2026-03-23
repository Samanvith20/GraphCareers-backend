// ─── ai.controller.js ────────────────────────────────────────────────────────
//
// Key design: decouple streaming-to-client from the actual AI work.
//
// If the user navigates away mid-stream, `req` emits a "close" event.
// We stop WRITING to the response (client is gone) but we do NOT abort
// the service — it finishes the AI call, saves the full message to DB,
// and deducts credits. When the user returns to that session they see
// the complete response.
//
// If the user clicks Stop, the frontend sends DELETE /api/ai/chat/abort/:sessionId
// which sets a flag the service checks — this is the intentional cancel path.

import logger from "../logger/logger.js";
import {
  chatService,
  getSessionsByUser,
  loadSessionHistory,
  deleteSession,
} from "../services/chat.services.js";
import { getUserAccessFromUser } from "../services/userAccess.service.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

export async function chat(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;

  try {
    const { userMessage, sessionId = null } = req.body;

    if (!userMessage?.trim()) {
      return res.status(400).json({ error: "userMessage is required" });
    }

    logger.info("[chat] request", { requestId, userId, sessionId: sessionId ?? "new" });

    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.flushHeaders();

    // Track whether client is still connected
    // When user navigates away, this flips to false — we stop writing
    // but the service generator keeps running until it finishes
    let clientConnected = true;
    req.on("close", () => {
      clientConnected = false;
      logger.info("[chat] client disconnected — continuing in background", {
        requestId,
        userId,
      });
    });

    const gen = chatService(userMessage.trim(), userId, sessionId);

    for await (const chunk of gen) {
      if (!chunk) continue;

      // Always process session_id internally regardless of connection state
      if (chunk.type === "session_id") {
        // Still write this even if client just disconnected — race condition
        // means they might still receive it
        if (clientConnected) {
          res.write(`s:${JSON.stringify({ sessionId: chunk.sessionId })}\n`);
        }
        continue;
      }

      if (chunk.type === "tool_status") {
        if (clientConnected) {
          res.write(`9:${JSON.stringify({ toolName: chunk.toolName })}\n`);
        }
        continue;
      }

      if (chunk.type === "token") {
        // Only write tokens if client is still there — no point buffering
        if (clientConnected) {
          res.write(`0:${JSON.stringify(chunk.content)}\n`);
        }
        continue;
      }

      if (chunk.type === "tool_done") {
        if (clientConnected) res.write(`a:{}\n`);
        continue;
      }
    }

    // Service has fully completed (message saved to DB, credits deducted)
    if (clientConnected) {
      res.write(`d:{}\n`);
      res.end();
    }

    logger.info("[chat] stream complete", { requestId, userId });

  } catch (err) {
    logger.error("[chat] failed", { requestId, userId, error: err.message });

    if (!res.headersSent) return next(err);

    try {
      res.write(`3:${JSON.stringify({ error: err.message })}\n`);
      res.end();
    } catch {
      // Client already disconnected — ignore write errors
    }
  }
}

// ─── GET /api/ai/sessions ─────────────────────────────────────────────────────

export async function getSessions(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;

  try {
    const user = await db.query.users.findFirst({
      where:   eq(users.id, userId),
      columns: { id: true, credits: true, tier: true, planExpiresAt: true },
    });

    const access = getUserAccessFromUser(user);
    const isPro  = access.plan === "pro";

    const sessions = await getSessionsByUser(userId, isPro);

    logger.info("[chat] sessions fetched", { requestId, userId, count: sessions.length });

    res.json({ sessions, isPro });

  } catch (err) {
    logger.error("[chat] getSessions failed", { requestId, error: err.message });
    next(err);
  }
}

// ─── GET /api/ai/sessions/:sessionId/messages ─────────────────────────────────

export async function getSessionMessages(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;
  const { sessionId } = req.params;

  try {
    const { chatSessions, chatMessages } = await import("../db/schema.js");
    const { and, eq, asc } = await import("drizzle-orm");

    const session = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
    });

    if (!session) return res.status(404).json({ error: "Session not found" });

    const messages = await db.query.chatMessages.findMany({
      where:   eq(chatMessages.sessionId, sessionId),
      orderBy: asc(chatMessages.createdAt),
      columns: { id: true, role: true, content: true, createdAt: true },
    });

    logger.info("[chat] messages fetched", { requestId, sessionId, count: messages.length });

    res.json({ session, messages });

  } catch (err) {
    logger.error("[chat] getMessages failed", { requestId, error: err.message });
    next(err);
  }
}

// ─── DELETE /api/ai/sessions/:sessionId ──────────────────────────────────────

export async function deleteSessionHandler(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;
  const { sessionId } = req.params;

  try {
    await deleteSession(userId, sessionId);
    logger.info("[chat] session deleted", { requestId, userId, sessionId });
    res.json({ success: true });
  } catch (err) {
    logger.error("[chat] deleteSession failed", { requestId, error: err.message });
    next(err);
  }
}