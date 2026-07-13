# GraphCareers: Product & AI Feature Roadmap

## 1. Competitor Research (Is this the first in India?)
**Result:** You are **not** the first in India, but the market is still very new and there is a huge opportunity to be the *best*. 
Currently in India, there are a few startups solving this:
- **ApplyCove** and **FastApply**: They auto-apply on Naukri/LinkedIn and handle India-specific fields (Notice Period, Expected CTC).
- **myjobb AI**: Markets itself as an end-to-end AI agent for searching, auto-applying, and finding referrals.
- **Global Tools** (used in India): LoopCV, LazyApply, Careerflow, Teal.

**Your Unique Advantage:** 
Most of these tools are just "dumb form fillers" or Chrome extensions. **GraphCareers** has a Neo4j Graph Database that understands the topology of careers and skills. If we fix the matching algorithm, your platform will recommend jobs and career paths *far more intelligently* than a basic auto-apply bot.

---

## 2. Immediate Fixes & Technical Mistakes (Phase 1)

### A. The "Same Jobs Every Day" Email Bug
* **The Problem:** The daily email recommendation sends the same jobs because the `jobs.service.js` query returns the same top matches every time it runs. It does not track which jobs the user has already seen or received.
* **The Fix:** We need to create an `emailed_jobs` table (or add an `emailed_at` timestamp in `job_matches`). When the daily worker runs, it must filter out jobs where `job_id` is already in the user's emailed list.

### B. "Wrong Jobs" & Overly Strict Matching
* **The Problem:** The current matching algorithm is too strict. It requires 3 exact skill matches, limits jobs to the last 3 days, and rigidly enforces experience buckets. This hides 90% of the good jobs.
* **The Fix:**
  1. Increase job search window to 14 or 30 days.
  2. Reduce the skill match threshold to `>= 1` or remove the hard cut-off.
  3. Widen experience buckets (allow users to see jobs asking for slightly more experience as "stretch" goals).

### C. Broken Career Progression (Title-Matching)
* **The Problem:** `careerProgression.service.js` requires the next job to share a word (e.g., "Frontend" -> "Senior Frontend"). It fails to map "Frontend" -> "React Engineer".
* **The Fix:** Rewrite the query to use **Skill Overlap (Jaccard Similarity)**. If two roles share 60% of the same skills, they are a valid progression path regardless of the title.

---

## 3. Advanced AI Features & Innovations (Phase 2 & 3)

### A. The "Networking & Referral" Engine (High Priority)
* **The Idea:** For the top matched jobs, automatically find the recruiter, HR, or CEO's email format. 
* **Implementation:** 
  1. Use an API like Apollo.io, Hunter.io, or clearbit to fetch company email domains.
  2. Generate a highly personalized **Cold DM / Email Draft** using the LLM. 
  3. *Example Output:* "Hi [HR Name], I noticed [Company] is hiring a React Engineer. I have 90% of the required skills, specifically my experience with [User's Skill]..."

### B. One-Click AI Auto-Apply Agent
* **The Idea:** Build an agent (via Puppeteer/Playwright or a Chrome Extension) that takes the user's parsed AI-optimized resume and automatically fills out Workday, Lever, and Greenhouse forms.
* **Implementation:** This is complex but highly valuable. We can build a backend worker that uses headless browsers and AI vision/DOM parsing to map resume fields to form fields.

### C. "Interview Prep" AI Agent
* **The Idea:** Once a user matches with a job, they can click "Prep Me". The AI takes the specific job description and the user's resume, and acts as the Hiring Manager in a chat interface, grilling them on the exact skills they are missing or need to defend.

### D. The "Missing Skill" Crash Course
* **The Idea:** Instead of just telling them "You need to learn Docker", we integrate with the YouTube Data API to automatically generate a 3-video playlist perfectly tailored to teach them the gap in their knowledge based on the job they want.

### E. Gamification & Streaks
* **The Idea:** Users lose motivation fast. If they apply to 3 jobs a day via your platform or complete a learning module, they get a "streak". 

---

## Implementation Plan

We will implement this roadmap one step at a time:
1. **First:** Fix the `jobs.service.js` filters so they actually see the good jobs.
2. **Second:** Fix the `emailWorker` so it stops sending duplicates.
3. **Third:** Overhaul the `careerProgression` pathing.
4. **Fourth:** Build the Networking / Cold Email AI feature.
5. **Fifth:** Begin researching headless browser automation for Auto-Apply.
