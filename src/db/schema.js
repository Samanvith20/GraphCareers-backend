//import { boolean } from "drizzle-orm/gel-core";
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  bigint,
  varchar,
  timestamp,
  uuid,
  integer,
  doublePrecision,
  uniqueIndex,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const tierEnum = pgEnum("tier", ["free", "pro", "enterprise"]);
export const resumeStatusEnum = pgEnum("resume_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name"),
  email: varchar("email").unique(),
  password: varchar("password"),
  skills: text("skills").array(),
  location: varchar("location"),
  experience: integer("experience"), 
  bio: text("bio"),
  role: varchar("role"),
  createdAt: timestamp("created_at").defaultNow(),
  tier: tierEnum("tier").default("free"),
  credits: integer("credits").default(10),
  planExpiresAt: timestamp("plan_expires_at"),
  lastCreditReset: timestamp("last_credit_reset"),
  resetToken: varchar("reset_token", { length: 255 }),
  resetTokenExpiry: bigint("reset_token_expiry", { mode: "number" }),
  lastEmailSentAt: timestamp("last_email_sent_at"),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),

  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),

  razorpayOrderId: varchar("razorpay_order_id", { length: 255 }),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 255 }).unique(),
  razorpayPaymentMethod:varchar("razorpay_payment_method",{length:300}),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
  amount: integer("amount"), // in paise
  currency: varchar("currency", { length: 10 }).default("INR"),

  status: varchar("status", { length: 50 }), // created, paid, failed

  createdAt: timestamp("created_at").defaultNow(),
});

export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),

  userId: uuid("user_id")
  .references(() => users.id)
  .notNull(),


  feature: varchar("feature", { length: 50 }).notNull(),
  model: varchar("model", { length: 80 }),

  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  totalTokens: integer("total_tokens").default(0),

  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => ({
    userDateIdx: index("ai_usage_user_date_idx").on(
      table.userId,
      table.createdAt
    ),
  })

);


export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull()
    .unique(),
  pendingFileName :varchar("pending_filename"),
  fileName: varchar("file_name"),
  fileType: varchar("file_type"),
  status: resumeStatusEnum("status").default("pending"),
  errorMessage: varchar("error_message", { length: 255 }),

  text: text("text"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  isResumeParsed: boolean("is_resume_parsed").default(false),
},
(table) => ({
    userIdx: index("resumes_user_idx").on(table.userId),
  })
);

// Job table to store job details fetched from external sources need to update on every fetch
export const jobMatches = pgTable(
  "job_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),

    // 🔥 IMPORTANT: use sourceJobId (string from Neo4j)
    jobSourceId: varchar("job_source_id", { length: 255 }).notNull(),

    matchedCount: integer("matched_count").default(0),
    requiredCount: integer("required_count").default(0),

    matchPercent: doublePrecision("match_percent").default(0),
    score: doublePrecision("score").default(0),

    matchedSkills: text("matched_skills").array().default([]),
    missingSkills: text("missing_skills").array().default([]),
    isEmailed: boolean("is_emailed").default(false),

    matchedAt: timestamp("matched_at").defaultNow(),
  },
  (table) => {
  return {
    userIdx: index("job_matches_user_idx").on(table.userId),

    jobSourceIdx: index("job_matches_source_idx").on(table.jobSourceId),

    scoreIdx: index("job_matches_score_idx").on(table.score),

    userMatchedIdx: index("job_matches_user_matched_idx").on(
      table.userId,
      table.matchedAt
    ),

    emailedIdx: index("job_matches_user_emailed_idx").on(
      table.userId,
      table.isEmailed
    ),

    uniqueUserJob: uniqueIndex("job_matches_user_job_idx").on(
      table.userId,
      table.jobSourceId
    ),
  };
}
);


export const jobStatusEnum = pgEnum("job_status", [
  "new",          // freshly matched, user hasn’t touched
  "viewed",       // user opened the job
  "saved",        // bookmarked
  "applied",      // user applied
  "interviewing", // in interview process
  "offer",        // got offer
  "rejected",     // rejected by company
  "ignored",      // user not interested
]);

export const userJobApplications = pgTable(
  "user_job_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    jobUrl: text("job_url"),
    jobTitle: text("job_title"),
    company: text("company"),
    source: text("source"), // linkedin, naukri, etc

    status: jobStatusEnum("status")
      .notNull()
      .default("new"),

    notes: text("notes"),

    createdAt: timestamp("created_at")
      .notNull()
      .defaultNow(), // first time shown to user

    statusUpdatedAt: timestamp("status_updated_at")
      .notNull()
      .defaultNow(), // last status change
  },
 
);


export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    sourceJobId: varchar("source_job_id", { length: 255 }).notNull(),
    source: varchar("source", { length: 100 }),
    sourceUrl: text("source_url"),

    title: text("title").notNull(),
    roleTitle: text("role_title"),
    company: text("company"),

    // 🔥 Flattened skills (VERY IMPORTANT for querying)
    skillsTechnical: text("skills_technical").array(),
    skillsTools: text("skills_tools").array(),
    skillsSoft: text("skills_soft").array(),

    // experience
    minExp: integer("min_experience"),
    maxExp: integer("max_experience"),
    difficultyLevel: varchar("difficulty_level", { length: 50 }),

    // salary
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: varchar("salary_currency", { length: 10 }),
    salaryPeriod: varchar("salary_period", { length: 20 }),

    // location
    location: text("location"),
    locationState: text("location_state"),
    locationCountry: text("location_country"),

    jobType: varchar("job_type", { length: 50 }),
    workMode: varchar("work_mode", { length: 50 }),

    industry: text("industry").array(),

    description: text("description"),

    postedAt: timestamp("posted_at"),
    expiryAt: timestamp("expiry_at"),

    isPublished: boolean("is_published").default(false),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sourceIdx: index("jobs_source_idx").on(table.source),
    titleIdx: index("jobs_title_idx").on(table.title),
    postedIdx: index("jobs_posted_idx").on(table.postedAt),
  })
);

// chat schemas
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
 
    // Auto-generated from first user message (e.g. "What should I learn next?")
    // Kept short — 60 chars max, generated by AI in background
    title:        text("title").notNull().default("New chat"),
 
    // Soft-delete — free users keep last 5, older ones are hidden not deleted
    isArchived:   boolean("is_archived").notNull().default(false),
 
    // Denormalised count — avoids COUNT(*) on messages for sidebar rendering
    messageCount: integer("message_count").notNull().default(0),
 
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
 
    // Updated whenever a new message is added — used for "newest first" sort
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Primary query pattern: all sessions for a user, ordered by updatedAt DESC
    userUpdatedIdx: index("chat_sessions_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

// ─── chat_messages ────────────────────────────────────────────────────────────
// Every individual message. Loaded when user clicks a session to resume it.
// For context window injection, we load the last N messages of the active session.
 
export const chatMessages = pgTable(
  "chat_messages",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    sessionId:   uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
    userId:      uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
 
    role:        messageRoleEnum("role").notNull(),
    content:     text("content").notNull(),
 
    // Track token usage per message for cost analytics + credit decisions
    tokensUsed:  integer("tokens_used").default(0),
 
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Primary query: last N messages in a session (ORDER BY created_at DESC LIMIT N)
    sessionCreatedIdx: index("chat_messages_session_created_idx").on(t.sessionId, t.createdAt),
 
    // Secondary: all messages for a user (for full history export in future)
    userCreatedIdx: index("chat_messages_user_created_idx").on(t.userId, t.createdAt),
  }),
);
// ─── user_memories ────────────────────────────────────────────────────────────
// Extracted facts about a user derived from their conversations.
// These are injected into the system prompt on EVERY request — even new chats.
// This is what makes the agent feel like it "knows" the user across sessions.
//
// key examples:
//   "target_role"         → "data engineer"
//   "preferred_location"  → "hyderabad, open to remote"
//   "weak_skills"         → "kafka, system design"
//   "job_search_status"   → "actively looking, applying to startups"
//   "experience_level"    → "2 years, transitioning from backend to data"
//   "salary_expectation"  → "8-12 LPA"
 
export const userMemories = pgTable(
  "user_memories",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    userId:          uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
 
    // The memory key — e.g. "target_role", "weak_skills"
    // Short snake_case identifiers, defined by your extraction prompt
    key:             text("key").notNull(),
 
    // The extracted value — plain text, can be comma-separated list
    value:           text("value").notNull(),
 
    // Which session this memory was last updated from — useful for debugging
    // "why does the agent think I want X?"
    sourceSessionId: uuid("source_session_id")
      .references(() => chatSessions.id, { onDelete: "set null" }),
 
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // UNIQUE: one row per (user, key) — upsert by this constraint
    userKeyIdx: uniqueIndex("user_memories_user_key_idx").on(t.userId, t.key),
 
    // Load all memories for a user in one query
    userIdx: index("user_memories_user_idx").on(t.userId),
  }),
);

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user:     one(users,        { fields: [chatSessions.userId],    references: [users.id] }),
  messages: many(chatMessages),
  memories: many(userMemories),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, { fields: [chatMessages.sessionId], references: [chatSessions.id] }),
  user:    one(users,        { fields: [chatMessages.userId],    references: [users.id] }),
}));

export const userMemoriesRelations = relations(userMemories, ({ one }) => ({
  user:          one(users,        { fields: [userMemories.userId],          references: [users.id] }),
  sourceSession: one(chatSessions, { fields: [userMemories.sourceSessionId], references: [chatSessions.id] }),
}));

export const userJobEmailLog = pgTable(
  "user_job_email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),


    emailedAt: timestamp("emailed_at").defaultNow(),
    jobSourceId: varchar("job_source_id", { length: 255 }).notNull(),
  },
  (table) => ({
    userIdx: index("email_log_user_idx").on(table.userId),

    // 🔥 CRITICAL: prevents duplicate emails
    uniqueUserJob: uniqueIndex("email_log_user_job_idx").on(
      table.userId,
       table.jobSourceId
    ),
  })
);

