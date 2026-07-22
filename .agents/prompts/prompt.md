# GraphCareers AI Resume Intelligence - Phase 4: AI Planner Architecture

You are acting as the Principal AI Architect for GraphCareers.

Previous phases are complete.

## Existing System

The backend already contains:

- Resume Upload & Parser
- Resume Workspace
- Resume Versions
- Resume Events
- Resume Intelligence Engine
- Resume Orchestrator
- OptimizationContext
- Legacy Resume Optimizer
- ATS Engine
- Neo4j Job Matching
- Recommendation Engine
- PDF Generation

These systems are production-ready.

Do NOT redesign them.

Do NOT replace them.

---

## Objective

Design an AI Planner that becomes the reasoning engine for Resume Optimization.

The Planner must NOT modify resumes.

The Planner must NOT rewrite text.

The Planner must NOT call external services directly.

Its only responsibility is to analyze the OptimizationContext and produce an execution plan describing what should change.

The Planner should become the first AI component executed after the Resume Orchestrator.

Future Tool Executors and Patch Engines will consume its output.

---

## Planner Responsibilities

The Planner should:

- Read the OptimizationContext.
- Analyze the active resume version.
- Analyze Resume Intelligence.
- Analyze ATS baseline.
- Analyze platform requirements.
- Analyze market trends (future-compatible).
- Identify optimization opportunities.
- Prioritize improvements.
- Produce a deterministic execution plan.

The Planner should NEVER modify the resume directly.

---

## Planner Output

Design a structured execution plan.

Each operation should include:

- operation type
- target section
- reason
- priority
- expected ATS impact
- confidence
- required evidence

Example operations include:

- Rewrite Summary
- Rewrite Project
- Improve Experience Bullet
- Reorder Skills
- Highlight Technology
- Add Missing Keyword
- Remove Redundant Content

Do not design Tool Execution.

Only design the plan format.

---

## Deliverables

Provide:

1. Planner architecture
2. Planner lifecycle
3. Folder structure
4. Service interfaces
5. Planner input model
6. Planner output schema
7. Sequence diagrams
8. Planner prompt strategy
9. Confidence scoring
10. Rule engine design
11. Error handling
12. Future integration with Tool Executor
13. Implementation checklist
14. Commit plan

---

## Constraints

- Zero breaking changes.
- Legacy Optimizer continues working.
- Planner only generates plans.
- No Tool Executor.
- No Patch Engine.
- No Resume Editing.
- No Dynamic Tool Calling.
- Production-grade architecture only.

Design this as a long-term AI planning layer that will eventually replace the reasoning currently embedded inside the Legacy Optimizer.