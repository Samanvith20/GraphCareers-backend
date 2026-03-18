//import { boolean } from "drizzle-orm/gel-core";
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
  resetToken: varchar("reset_token", { length: 255 }),
  resetTokenExpiry: bigint("reset_token_expiry", { mode: "number" }),
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
// export const jobMatches = pgTable("job_matches", {
//   id: uuid("id").primaryKey().defaultRandom(),

//   userId: uuid("user_id")
//     .references(() => users.id)
//     .notNull(),

//   jobId: uuid("job_id")
//     .references(() => jobs.id)
//     .notNull(),

//   matchedCount: integer("matched_count"),
//   requiredCount: integer("required_count"),
//   score: doublePrecision("score"),
//   missingSkills: text("missing_skills").array(),

//   matchedAt: timestamp("matched_at").defaultNow(),
// }, (table) => ({
//   userIdx: index("job_matches_user_idx").on(table.userId),
//   jobIdx: index("job_matches_job_idx").on(table.jobId),
//   scoreIdx: index("job_matches_score_idx").on(table.score),
// }));


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
