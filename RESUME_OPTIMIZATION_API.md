# Resume Optimization API Documentation

This document outlines the available REST API endpoints for the Platform-Wide Resume Optimization feature in the GraphCareers Backend. These endpoints allow the frontend to trigger asynchronous resume optimizations for specific platforms (like Naukri, LinkedIn, etc.), poll for the status, retrieve the resulting ATS metrics and JSON structures, and download the generated files.

## Base URL
`/api/resume-intelligence`

---

## 1. Trigger Platform Optimization

Triggers a background AI job to optimize the user's master resume against the top 100 job matches for a specific platform.
- **Cost**: 2 Credits.
- **Rate Limiting**: Strictly 1 active optimization pending globally per user. Duplicate triggers for the same platform will be ignored/deduplicated.

**Endpoint**: `POST /:platform/optimize`  
**Auth Required**: Yes (Bearer Token)

### Path Parameters
- `platform` (string): The target platform to optimize for (e.g., `naukri`, `linkedin`, `instahyre`).

### Request Body
*None required.*

### Expected Response (Status: 202 Accepted)
```json
{
  "success": true,
  "message": "Resume optimization started",
  "status": "pending"
}
```

---

## 2. Get Optimization Status & Results

Retrieves the current status of the background optimization job. The frontend should poll this endpoint until `status` is `completed` or `failed`.

**Endpoint**: `GET /:platform/status`  
**Auth Required**: Yes (Bearer Token)

### Path Parameters
- `platform` (string): The target platform (e.g., `naukri`).

### Expected Response - Pending/Processing (Status: 200 OK)
```json
{
  "success": true,
  "platform": "naukri",
  "status": "pending", // Can be "pending" or "processing"
  "createdAt": "2024-05-10T12:00:00Z",
  "updatedAt": "2024-05-10T12:00:00Z"
}
```

### Expected Response - Completed (Status: 200 OK)
Once the job is done, the payload is heavily populated with AI insights, ATS metrics, and the full optimized JSON ready for frontend rendering.
```json
{
  "success": true,
  "platform": "naukri",
  "status": "completed",
  "createdAt": "2024-05-10T12:00:00Z",
  "updatedAt": "2024-05-10T12:05:00Z",
  
  "atsScores": {
    "before": 45,
    "after": 85,
    "improvement": 40,
    "breakdown": {
      "before": { /* Structural breakdown before */ },
      "after": { /* Structural breakdown after */ }
    }
  },
  
  "optimizedResume": {
    "contact": { "name": "John Doe", "email": "john@example.com", "phone": "..." },
    "summary": "Data Engineer with 4 years...",
    "experience": [
      { "company": "Tech Corp", "title": "Data Engineer", "bullets": ["Optimized pipelines..."] }
    ],
    "projects": [],
    "skills": {
      "languages": ["Python", "SQL"],
      "frameworks": ["Spark", "Kafka"]
    },
    "education": [],
    "certifications": [],
    "optimizationNotes": ["Added Kafka keyword to Tech Corp bullet 2"]
  },
  
  "keywords": {
    "matched": ["Python", "SQL"],
    "missing": ["Airflow", "AWS"],
    "added": ["Kafka", "ETL"]
  },
  
  "skillRecommendations": [
    {
      "skill": "AWS",
      "pct": 80,
      "importance": "critical",
      "learnMessage": "AWS is required by 80% of Naukri Data Engineer roles."
    }
  ],
  
  "platformInsights": {
    "topSkills": ["Python", "SQL", "AWS", "Kafka", "Spark"],
    "experienceDistribution": { "3-5 years": 60, "1-3 years": 30 },
    "workModeDistribution": { "Remote": 40, "Hybrid": 50 }
  },
  
  "recommendations": [
    "Add more quantifiable metrics to your experience bullets."
  ]
}
```

### Expected Response - Failed (Status: 200 OK)
```json
{
  "success": true,
  "platform": "naukri",
  "status": "failed",
  "createdAt": "2024-05-10T12:00:00Z",
  "updatedAt": "2024-05-10T12:01:00Z",
  "errorMessage": "AI generation timed out after 120 seconds."
}
```

---

## 3. Download Optimized Resume (PDF)

Generates and downloads the PDF version of the strictly optimized resume.

**Endpoint**: `GET /:platform/download/pdf`  
**Auth Required**: Yes (Bearer Token)

### Path Parameters
- `platform` (string): The target platform (e.g., `naukri`).

### Expected Response
- **Headers**: 
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename="CandidateName_naukri_Resume.pdf"`
- **Body**: The binary stream of the generated PDF file.

---

## 4. Download Optimized Resume (DOCX)

Generates and downloads the Microsoft Word (DOCX) version of the strictly optimized resume.

**Endpoint**: `GET /:platform/download/docx`  
**Auth Required**: Yes (Bearer Token)

### Path Parameters
- `platform` (string): The target platform (e.g., `naukri`).

### Expected Response
- **Headers**: 
  - `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `Content-Disposition: attachment; filename="CandidateName_naukri_Resume.docx"`
- **Body**: The binary stream of the generated DOCX file.

---

## 5. Resume Workspace & Versions
**Base URL**: `/api/resume-workspace`

The workspace manages the user's resume versions. It allows tracking of changes over time, comparing different AI-optimized or manually edited versions, and retrieving AI suggestions.

- **Load Workspace**: `GET /`
  - Retrieves or lazily creates the workspace for the user.
- **Get Version Details**: `GET /versions/:versionId`
  - Retrieves the full snapshot and analyses for a specific version.
- **Activate Version**: `POST /versions/:versionId/activate`
  - Sets a specific version as the "active" version for the user.
- **Compare Versions**: `GET /compare?versionA=uuid&versionB=uuid`
  - Compares the ATS scores and keywords between two versions.
- **Workspace Events Timeline**: `GET /events?limit=20&offset=0`
  - Retrieves the timeline of events (e.g., version created, optimization started/completed) for the workspace.
- **Get AI Suggestions**: `GET /versions/:versionId/suggestions`
  - Retrieves structured AI suggestions for improving the specific resume version.

---

## 6. Copilot Chat
**Base URL**: `/api/resume/copilot`

The Copilot allows the user to interactively chat with the AI about a specific resume version to ask for advice or discuss modifications.

- **Get Optimization Report**: `GET /:versionId/report`
  - Returns the detailed report (ATS scores, executed operations, modifications) for a specific optimized version.
- **Chat with Copilot**: `POST /:versionId/chat`
  - **Body**: `{ "message": "User's chat message" }`
  - **Expected Response**: The AI's response regarding the resume, taking the current version's context into account.

---

## 7. Resume Editor
**Base URL**: `/api/resume/edit`

Allows applying manual or programmatic edits to a specific resume version.

- **Apply Edit**: `POST /:versionId`
  - **Body**: Contains the edit action type and payload (e.g., adding a skill, editing a bullet point).
  - **Expected Response**: Generates a new resume version snapshot applying the requested changes and returns the new `versionId`.

---

## 8. JD Optimization (Job Description specific)
**Base URL**: `/api/resume/jd-optimize`

While `resume-intelligence` optimizes for an entire platform globally, this endpoint allows targeted optimization against a specific, individual Job Description.

- **Optimize for JD**: `POST /:versionId`
  - **Body**: Contains the Job Description text, URL, or job requirements.
  - **Expected Response**: Triggers an optimization process specifically tuned for the provided JD, returning a new highly-tailored resume version.
