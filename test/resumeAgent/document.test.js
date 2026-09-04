import test from "node:test";
import assert from "node:assert/strict";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { generateDocx, generatePdf } from "../../src/services/documentGenerator.service.js";

const resume = {
  contact: { name: "A Candidate", email: "candidate@example.com", phone: "+91 9000000000" },
  summary: "Backend engineer focused on reliable Java services and production systems.",
  skills: { Technical: ["Java", "Spring Boot", "PostgreSQL"] },
  experience: [{
    title: "Backend Engineer",
    company: "Example Systems",
    startDate: "2022",
    endDate: "Present",
    bullets: ["Built Java services that reduced processing time by 30%."],
  }],
  education: [{ degree: "B.Tech", institution: "Example University" }],
};

test("generated DOCX survives a raw-text parse back", async () => {
  const buffer = await generateDocx(resume);
  const text = (await mammoth.extractRawText({ buffer })).value;
  assert.match(text, /candidate@example\.com/i);
  assert.match(text, /Example Systems/i);
  assert.match(text, /Spring Boot/i);
});

test("generated PDF survives a text parse back", async () => {
  const buffer = await generatePdf(resume);
  const result = await extractText(new Uint8Array(buffer));
  const text = Array.isArray(result.text) ? result.text.join(" ") : result.text;
  assert.match(text, /candidate@example\.com/i);
  assert.match(text, /Example Systems/i);
  assert.match(text, /Spring Boot/i);
});

