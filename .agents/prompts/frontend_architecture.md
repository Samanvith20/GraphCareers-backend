# GraphCareers Frontend Architecture & UI Design Document

## 1. Executive Summary
The GraphCareers frontend will be transformed from a static, form-heavy traditional resume builder into a premium, AI-native workspace. Inspired by modern developer and productivity tools (Linear, Notion AI, Cursor, Vercel Dashboard), the new UI will feature real-time updates, optimistic UI, and deep integration with our robust AI backend orchestration. The core paradigm shifts from "building a resume" to "managing a living Resume Workspace" driven by AI intelligence, Copilot chat, and 1-click targeted suggestions.

## 2. API Mapping & Data Consumption
The UI will exclusively consume the existing backend endpoints. Zero new backend endpoints are required.

### A. Workspace & Versioning
- **`GET /api/resume-workspace`**: Hydrates the main workspace (Sidebar, current active version).
- **`GET /api/resume-workspace/versions/:versionId`**: Loads a specific version for the main center preview.
- **`GET /api/resume-workspace/events`**: Populates the Bottom Drawer "Version Timeline" history.
- **`POST /api/resume-workspace/versions/:versionId/activate`**: Triggered when a user restores or switches to a historical version from the timeline.
- **`GET /api/resume-workspace/compare`**: Used when a user compares two versions in the timeline.

### B. AI Suggestions Engine (Phase 9)
- **`GET /api/resume-workspace/versions/:versionId/suggestions`**: Populates the "Suggestions" panel in the Right Panel. Displays chips categorized by MARKET_SKILL, ATS_IMPROVEMENT, etc.

### C. Resume Editing API (Phase 8)
- **`POST /api/resume/edit/:versionId`**: The single universal mutation endpoint for modifications.
  - *Used by Suggestions:* When a user clicks "Apply" on a suggestion, the UI sends the suggestion's exact `actionType` and `actionPayload` here.
  - *Used by Quick Actions:* Buttons like "Shorten", "Lengthen", "Fix Typos" send their respective `actionType` payload.
  - *Used by Inline Edits:* If the user manually edits the PDF preview, it sends a targeted `REWRITE` payload to gracefully update the backend.

### D. Resume Copilot & Reports (Phase 7)
- **`GET /api/resume/copilot/:versionId/report`**: Populates the "Optimization Report" in the Right Panel (showing ATS Before/After, sections modified, planner reasoning).
- **`POST /api/resume/copilot/:versionId/chat`**: Powers the ChatGPT-like Copilot UI. Updates append to the chat UI and stream responses explaining ATS scores, reasoning, or applying edits.

### E. JD Optimization (Phase 10)
- **`POST /api/resume/jd-optimize/:versionId`**: Powers the JD Optimization Screen. User pastes JD, UI sends payload `{ jobTitle, companyName, jobDescription }`. Backend generates the tailored version and match report.

---

## 3. Information Architecture & Layout

The primary view is the **Resume Workspace**, eliminating the need for disjointed page navigations.

### Global Layout Structure
```text
+-----------------------------------------------------------------------------+
| Sidebar (Left)   | Main Area (Center)            | Right Panel              |
|------------------|-------------------------------|--------------------------|
| - Master Resume  | [Live PDF-Like Preview]       | [Tabs: Copilot | Report] |
| - Naukri Version |                               |                          |
| - Amazon JD V1   |   (Editable blocks with       | - Optimization Details   |
| - Microsoft JD   |    hover states and           | - Categorized AI         |
|                  |    inline AI actions)         |   Suggestions (1-click)  |
| - Downloads      |                               | - JD Match Metrics       |
|------------------|-------------------------------|--------------------------|
| Bottom Drawer (Timeline): [Master] -> [Naukri] -> [Improved Summary] -> ... |
+-----------------------------------------------------------------------------+
```

### Screen Drill-downs

#### 1. Platform Dashboard (Initial State)
- **Visuals:** Rich, dark-themed glassmorphic cards for platforms (Naukri, Instahyre, etc.).
- **Data:** Displays Readiness, Trending Skills, Last Optimized date.
- **Action:** Clicking a platform opens a 3-step wizard (Choose -> See Optimization Strategy -> Generate) that seamlessly transitions into the Workspace.

#### 2. The Resume Workspace (Core View)
- **Center Preview:** A beautifully rendered, interactive resume. Hovering over a bullet point reveals a mini-toolbar (Rewrite, Shorten, Expand).
- **Right Panel (Suggestions):** Instead of plain text, suggestions are categorized (e.g. "Missing Metrics"). Each has an "Impact Score" and a glowing "1-Click Apply" button.
- **Right Panel (Copilot):** A persistent chat interface. The user can type "Make my summary more aggressive", hitting the Copilot API.
- **Right Panel (Report):** Expanding cards detailing exactly what the AI Planner changed and why.

#### 3. JD Optimization Screen (Modal/Overlay)
- **Input:** A sleek form to paste the Job Description, Title, and Company.
- **Pre-flight:** Shows extracted skills, keyword match, and coverage *before* optimizing.
- **Action:** Clicking "Tailor Resume" triggers the JD API, returning a new child version in the Sidebar and immediately switching the Center Preview.

---

## 4. UI/UX & Visual Design Guidelines
- **Aesthetics:** Linear-esque Dark Theme, minimal typography (Inter/Geist), glassmorphism, gradient borders, and soft neon glows for AI actions.
- **Micro-interactions:** Framer Motion for smooth layout transitions. When an AI suggestion is applied, the specific bullet point in the preview should shimmer/pulse as it updates.
- **State:** Optimistic UI. When a user applies a suggestion, immediately show a loading skeleton on that specific section of the resume while the backend processes the `ExecutionPlan`.
- **Component Library:** Shadcn UI paired with TailwindCSS.

---

## 5. Technical Implementation Roadmap

1. **Setup & Foundation**
   - Initialize Next.js (App Router), TailwindCSS, Shadcn UI, and Framer Motion.
   - Configure React Query setup for robust caching and optimistic updates.
2. **State Management & Caching Strategy**
   - Use **Zustand** for global UI state (sidebar open/close, active panel tab).
   - Use **React Query (TanStack Query)** for all server state (fetching versions, events, suggestions).
   - *Caching Strategy:* `versionId` will be the primary cache key for queries. When an edit mutation succeeds, invalidate the `versionId` queries to trigger a fresh fetch of the new version and its suggestions.
3. **Component Hierarchy**
   - `<WorkspaceLayout>` (Controls Grid)
     - `<Sidebar>` (Renders Version Tree)
     - `<ResumePreview>` (Renders JSON snapshot to PDF-like DOM)
       - `<ResumeSection>` (Hoverable, editable)
     - `<RightPanel>`
       - `<CopilotChat>`
       - `<SuggestionsList>`
       - `<OptimizationReport>`
     - `<TimelineDrawer>`
4. **Integration Milestones**
   - *Milestone 1:* Read-only Workspace (Load versions, display PDF preview, display Timeline).
   - *Milestone 2:* Integration of AI Suggestions and JD Optimization (1-click applies).
   - *Milestone 3:* Real-time Copilot chat and Optimization Reports.
   - *Milestone 4:* Polish (Framer motion animations, glassmorphism, responsive behavior).
