// ─── ai.controller.js ────────────────────────────────────────────────────────

import logger from "../logger/logger.js";
import {
  chatService,
  getSessionsByUser,
  deleteSession,
} from "../services/chat.services.js";
import { getUserAccessFromUser } from "../services/userAccess.service.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { AppError } from "../lib/AppError.js";

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Body: { userMessage: string, sessionId?: string | null }
//
// Stream format (SSE-like, line-delimited):
//   s:<json>   — session_id event (always first chunk)
//   9:<json>   — tool status event
//   0:<json>   — text token
//   a:<json>   — tool result done
//   d:<json>   — stream done
//   3:<json>   — error

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

    const gen = chatService(userMessage.trim(), userId, sessionId);

    for await (const chunk of gen) {
      if (!chunk) continue;

      if (chunk.type === "session_id") {
        // First event — tells frontend which session this belongs to
        res.write(`s:${JSON.stringify({ sessionId: chunk.sessionId })}\n`);
        continue;
      }

      if (chunk.type === "tool_status") {
        res.write(`9:${JSON.stringify({ toolName: chunk.toolName })}\n`);
        continue;
      }

      if (chunk.type === "token") {
        res.write(`0:${JSON.stringify(chunk.content)}\n`);
        continue;
      }

      if (chunk.type === "tool_done") {
        res.write(`a:{}\n`);
        continue;
      }
    }

    res.write(`d:{}\n`);
    res.end();

    logger.info("[chat] stream complete", { requestId, userId });

  } catch (err) {
    logger.error("[chat] failed", { requestId, userId, error: err.message });

    // If headers not sent yet, use normal error response
    if (!res.headersSent) return next(err);

    // Headers sent — write error into the stream then close
    res.write(`3:${JSON.stringify({ error: err.message })}\n`);
    res.end();
  }
}

// ─── GET /api/ai/sessions ─────────────────────────────────────────────────────
// Returns list of sessions for the sidebar (newest first)

export async function getSessions(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;

  try {
    // Need plan to determine limit (free = 5, pro = all)
    const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          id: true,
          skills: true,
          experience: true,
          tier: true,
          credits: true,
          planExpiresAt: true,
        },
      });
         //console.log("sessions:;",user)
      if (!user) throw new AppError("User not found", 404);
 

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
// Returns full message history for a session (for resuming a chat)

export async function getSessionMessages(req, res, next) {
  const requestId = req.requestId;
  const userId    = req.userId;
  const { sessionId } = req.params;

  try {
    // loadSessionHistory validates ownership via getOrCreateSession pattern,
    // but here we load ALL messages (not just last 20) since user is resuming
    const { chatSessions, chatMessages } = await import("../db/schema.js");
    const { and, eq, asc } = await import("drizzle-orm");

    // Verify session belongs to this user
    const session = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.userId, userId),
      ),
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

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