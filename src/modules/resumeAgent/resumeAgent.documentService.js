import mammoth from "mammoth";
import { extractText } from "unpdf";
import { generateDocx, generatePdf } from "../../services/documentGenerator.service.js";
import { AppError } from "../../lib/AppError.js";
import { parseResumeSnapshot } from "./domain/resume.js";
import { normalizeTerm, tokenize } from "./domain/text.js";
import { requireVersion } from "./resumeAgent.repository.js";

function importantTokens(resume) {
  const values = [];
  const visit = (value) => {
    if (typeof value === "string" || typeof value === "number") values.push(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(resume);
  return new Set(tokenize(values.join(" ")).filter((token) => token.length >= 3));
}

function validateExtractedText(resume, extractedText) {
  const expected = importantTokens(resume);
  const actual = new Set(tokenize(extractedText));
  let found = 0;
  for (const token of expected) if (actual.has(token)) found += 1;
  const coverage = expected.size ? Math.round((found / expected.size) * 100) : 0;
  const required = [
    resume?.contact?.name,
    resume?.contact?.email,
    resume?.contact?.phone,
    resume?.contact?.linkedin,
    resume?.contact?.github,
    ...(resume?.experience || []).map((entry) => entry.company),
  ].filter(Boolean);
  const missingCriticalFields = required.filter((value) => !normalizeTerm(extractedText).includes(normalizeTerm(value)));
  return {
    passed: extractedText.trim().length >= 100 && coverage >= 80 && missingCriticalFields.length === 0,
    textCoverage: coverage,
    missingCriticalFields,
    extractedCharacters: extractedText.trim().length,
  };
}

export async function generateValidatedResumeDocument(userId, versionId, format) {
  const { version } = await requireVersion(userId, versionId);
  const resume = parseResumeSnapshot(version.snapshotJson);
  let buffer;
  let extractedText;
  if (format === "pdf") {
    buffer = await generatePdf(resume);
    const result = await extractText(new Uint8Array(buffer));
    extractedText = Array.isArray(result.text) ? result.text.join(" ") : result.text;
  } else if (format === "docx") {
    buffer = await generateDocx(resume);
    extractedText = (await mammoth.extractRawText({ buffer })).value;
  } else {
    throw new AppError("Document format must be pdf or docx", 400);
  }
  const validation = validateExtractedText(resume, extractedText || "");
  if (!validation.passed) {
    throw new AppError(`Generated ${format.toUpperCase()} failed ATS parse-back validation`, 422);
  }
  return { buffer, validation, resume, version };
}
