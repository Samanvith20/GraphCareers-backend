# GraphCareers Backend 🚀

> An AI-powered job matching and career progression platform backend.

GraphCareers Backend is a high-performance, containerized HTTP service built to facilitate dynamic career progression tracking, AI-powered resume extraction, complex path relation querying, and continuous metric capturing.

It leverages a hybrid database architecture (PostgreSQL for transactional data and Neo4j for graph relationships) to map user skills directly to industry-standard roles, generating personalized career roadmaps and resume optimizations via AI.

---

## 🛠️ Tech Stack

**Core Runtime & Framework**
* **Node.js v20** (Dockerized on Alpine Linux)
* **Express.js (v5)** with pure ES Modules (`import/export`)

**Databases & Caching**
* **PostgreSQL 16**: Primary relational database via **Drizzle ORM**
* **Neo4j**: Graph database for skills taxonomy and topological career mapping
* **Redis**: For Rate Limiting (`rate-limiter-flexible`) and Queue concurrency storage

**Background Jobs & AI**
* **BullMQ (v5)**: Distributed queue management and decoupled workers
* **Vercel AI SDK**: Generative AI pipeline powered by OpenRouter / OpenAI for resume content generation and extraction

**Observability & Monitoring**
* **Prometheus & Grafana**: Real-time server metrics (`/metrics` endpoint via `prom-client`)
* **Loki & Promtail**: Log aggregation
* **Winston**: Proxy-based structured application logging
* **Sentry**: Distributed application error tracking

**Utilities**
* **Zod**: Strong request payload validation
* **Razorpay**: Payment gateway integration for Pro-tier features
* **Multer**: File parsing and shared ephemeral volume uploads

---

## 🏗️ Architecture & Microservices

The application is fully containerized and uses `docker-compose` to orchestrate multiple independent microservices:

1. **`backend`**: The primary Express.js REST API server.
2. **`resume-worker`**: Processes queued resumes for generic tasks.
3. **`resume-parse-worker`**: Parses PDF/DOCX resumes and extracts structured JSON using AI.
4. **`resume-optimization-worker`**: Generates tailored ATS-optimized resumes based on targeted platform trends.
5. **`matcher-worker`**: Executes background topology matching via Neo4j.
6. **`email-worker`**: Manages asynchronous transactional email delivery.

### Request Lifecycle
All API requests pass through a strict sequence:
`CORS` ➡️ `Request ID Assignment` ➡️ `Metrics Timer` ➡️ `Auth (JWT)` ➡️ `Redis Rate Limiter` ➡️ `Zod Validation` ➡️ `Controller/Service Execution`.

---

## 🚀 Getting Started

### Prerequisites
* Docker and Docker Compose (v2)
* Node.js v20 (if running outside of Docker)
* `pnpm` (Corepack enabled)

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Samanvith20/GraphCareers-backend.git
   cd GraphCareers-backend
   ```

2. **Environment Variables:**
   Copy the example environment file and configure your local keys (Sentry, Razorpay, OpenAI, PostgreSQL, Neo4j, etc.).
   ```bash
   cp .env.example .env
   ```

3. **Start the Infrastructure:**
   Use Docker Compose to spin up all databases, workers, the backend API, and the observability stack.
   ```bash
   ENV_FILE=.env docker-compose up -d --build
   ```

4. **Database Migrations:**
   Push changes to PostgreSQL using Drizzle ORM.
   ```bash
   pnpm run db:push
   ```

The backend server will now be accessible at `http://localhost:4000`.
Grafana (Monitoring) will be available at `http://localhost:3000`.

---

## 📁 Project Structure

Following the Controller-Service-Repository pattern, the repository is highly modularized:

```
D:/GraphCareers/backend/
├── monitoring/                     # Prometheus, Loki, and Promtail configs
├── uploads/                        # Shared ephemeral volume for uploads
├── src/
│   ├── config/                     # Environment variables & client setups (Redis, etc.)
│   ├── controllers/                # Express route request handlers
│   ├── db/                         
│   │   ├── neo4j/                  # Neo4j session and driver wrappers
│   │   ├── index.js                # Postgres pooling
│   │   └── schema.js               # Drizzle ORM PostgreSQL schema
│   ├── lib/                        # Custom integrations (Sentry, AI config)
│   ├── logger/                     # Winston logger implementation
│   ├── middleware/                 # Auth, Zod Validation, Rate Limiters
│   ├── queue/                      # BullMQ queue initializations
│   ├── routes/                     # Express API endpoint mappings
│   ├── schemas/                    # Zod validation schemas
│   ├── scripts/                    # Dev utilities and testing scripts
│   ├── services/                   # Core business logic & database interaction
│   ├── workers/                    # BullMQ background workers execution logic
│   └── index.js                    # Server bootstrap entrypoint
├── Dockerfile                      # Multistage image building specs
├── docker-compose.yml              # Multi-container local staging config
└── package.json                    # ESM runtime dependencies
```

---

## 🧑‍💻 Development Guidelines

To maintain code quality and prevent regressions, please adhere to the following rules:

1. **Strict ESM Imports**: Always include file extensions for local module imports (e.g., `import { db } from "../db/index.js";`).
2. **Transaction Safety**: Wrap multi-table PostgreSQL operations in `db.transaction()` blocks to guarantee atomicity. Use `.onConflictDoUpdate()` for idempotency.
3. **Neo4j Cleanup**: Always close Neo4j sessions within a `finally {}` block to prevent connection leakage.
4. **Structured Logging**: NEVER use `console.log`. Always use the custom Winston logger and inject the request context:
   ```javascript
   logger.info("Task completed", { requestId: req.requestId });
   ```
5. **Error Propagation**: Never swallow errors in catch blocks. Forward all exceptions to the global error handler via `next(err)`. Operational failures should throw a custom `AppError`.
6. **No Raw Inputs**: All request bodies and parameters must be passed through `Zod` validation prior to service execution to prevent injection attacks and type errors.

---

## 🧠 AI & Neo4j Pipeline Architecture

GraphCareers leverages advanced workflows for platform-wide resume optimizations:

1. **Data Retrieval**: Matches the user to the top 100 jobs on a given platform via **Neo4j** based on existing skills.
2. **Trend Aggregation**: Computes targeted skill trends across these matching roles.
3. **Generation**: Invokes an LLM (via Vercel AI SDK) with the trend context and user's master resume to produce a highly ATS-optimized JSON resume variant.
4. **Resilience**: Employs Idempotency-Keys, 6-hour caching, strict timeout failsafes (15s Neo4j, 120s LLM), and active user rate-limiting (max 1 active optimization).

---

## 📄 License

Internal Proprietary Property.
