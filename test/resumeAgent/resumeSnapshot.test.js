import test from "node:test";
import assert from "node:assert/strict";
import { hydrateResumeContact, parseResumeSnapshot } from "../../src/modules/resumeAgent/domain/resume.js";

test("legacy top-level contact fields are preserved in the contact section", () => {
  const resume = parseResumeSnapshot({
    name: "Candidate",
    email: "candidate@example.com",
    phone: "+91 98765 43210",
    linkedin: "linkedin.com/in/candidate",
    github: "github.com/candidate",
  });
  assert.deepEqual(resume.contact, {
    name: "Candidate",
    email: "candidate@example.com",
    phone: "+91 98765 43210",
    location: null,
    linkedin: "linkedin.com/in/candidate",
    github: "github.com/candidate",
    portfolio: null,
  });
});

test("contact links embedded in source text hydrate missing parsed fields", () => {
  const resume = hydrateResumeContact(
    { contact: { name: "Candidate" } },
    { sourceText: "candidate@example.com +91 98765 43210 https://linkedin.com/in/candidate https://github.com/candidate" },
  );
  assert.equal(resume.contact.email, "candidate@example.com");
  assert.equal(resume.contact.phone, "+91 98765 43210");
  assert.equal(resume.contact.linkedin, "https://linkedin.com/in/candidate");
  assert.equal(resume.contact.github, "https://github.com/candidate");
});
