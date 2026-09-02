export const RESUME_AGENT_TOOLS = Object.freeze([
  {
    name: "analyze_target",
    mutates: false,
    confirmation: "never",
    description: "Build a normalized target from a platform market, career-page job, or user-provided JD.",
  },
  {
    name: "score_resume",
    mutates: false,
    confirmation: "never",
    description: "Calculate separate ATS compatibility, target match, and resume quality scores.",
  },
  {
    name: "propose_resume_changes",
    mutates: false,
    confirmation: "never",
    description: "Create evidence-aware changes without modifying the active resume.",
  },
  {
    name: "record_user_fact",
    mutates: true,
    confirmation: "required",
    description: "Record a skill or achievement explicitly attested by the user with provenance.",
  },
  {
    name: "apply_verified_changes",
    mutates: true,
    confirmation: "conditional",
    description: "Apply only evidence-safe or explicitly approved patches to a new immutable version.",
  },
  {
    name: "render_and_validate_resume",
    mutates: false,
    confirmation: "never",
    description: "Generate PDF or DOCX and parse it back to verify machine readability.",
  },
  {
    name: "activate_resume_version",
    mutates: true,
    confirmation: "required",
    description: "Make an existing user-owned version active without modifying its snapshot.",
  },
]);

