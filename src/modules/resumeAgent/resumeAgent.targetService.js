import { AppError } from "../../lib/AppError.js";
import { buildExactTarget, buildPlatformTarget, targetFingerprint } from "./domain/target.js";
import { createTarget, ensureWorkspace, getJobBySourceId, listPlatformJobs } from "./resumeAgent.repository.js";
import { resumeAgentModelGateway } from "./resumeAgent.modelGateway.js";

function targetResponse(target) {
  return {
    id: target.id,
    type: target.type,
    status: target.status,
    platform: target.platform,
    jobSourceId: target.jobSourceId,
    companyName: target.companyName,
    jobTitle: target.jobTitle,
    jobUrl: target.jobUrl,
    applicationUrl: target.applicationUrl,
    atsVendor: target.atsVendor,
    requirements: target.requirementsJson,
    createdAt: target.createdAt,
  };
}

export async function createPlatformTarget(userId, input, requestId) {
  const workspace = await ensureWorkspace(userId, requestId);
  const jobRows = await listPlatformJobs({
    platform: input.platform,
    role: input.role,
    location: input.location,
    sampleSize: input.sampleSize,
  });
  if (jobRows.length < 5) {
    throw new AppError("Not enough relevant jobs are available to build a reliable platform target", 422);
  }
  const requirements = buildPlatformTarget({ platform: input.platform, role: input.role, jobs: jobRows });
  const sourceSnapshotJson = {
    filters: input,
    sampleSize: jobRows.length,
    jobSourceIds: jobRows.map((job) => job.sourceJobId),
    generatedAt: new Date().toISOString(),
  };
  const fingerprint = targetFingerprint({ type: "platform_market", input, requirements });
  const target = await createTarget({
    userId,
    workspaceId: workspace.id,
    type: "platform_market",
    platform: input.platform,
    jobTitle: input.role,
    sourceSnapshotJson,
    requirementsJson: requirements,
    fingerprint,
  });
  return targetResponse(target);
}

export async function createCareerTarget(userId, input, requestId) {
  const workspace = await ensureWorkspace(userId, requestId);
  const storedJob = input.jobSourceId ? await getJobBySourceId(input.jobSourceId) : null;
  if (input.jobSourceId && !storedJob && !input.jobDescription) {
    throw new AppError("Career-page job was not found", 404);
  }
  const jobTitle = input.jobTitle || storedJob?.title;
  const companyName = input.companyName || storedJob?.company;
  const jobDescription = input.jobDescription || storedJob?.description;
  if (!jobTitle || !jobDescription) throw new AppError("The career-page job is missing a title or description", 422);

  const metadata = {
    requiredSkills: storedJob?.requirementsJson?.requiredSkills || [],
    preferredSkills: storedJob?.requirementsJson?.preferredSkills || [],
    responsibilities: storedJob?.requirementsJson?.responsibilities || [],
    keywords: storedJob?.requirementsJson?.keywords || [],
    skillsTechnical: storedJob?.skillsTechnical || [],
    skillsTools: storedJob?.skillsTools || [],
    minExp: storedJob?.minExp,
    maxExp: storedJob?.maxExp,
    location: storedJob?.location,
    workMode: storedJob?.workMode,
    screeningQuestions: input.screeningQuestions || storedJob?.screeningQuestionsJson || [],
  };
  const deterministic = buildExactTarget({
    type: "career_job",
    jobTitle,
    companyName,
    jobDescription,
    platform: input.platform || storedJob?.source,
    atsVendor: input.atsVendor || storedJob?.atsVendor,
    metadata,
  });
  const requirements = await resumeAgentModelGateway.extractTarget(
    { jobTitle, companyName, jobDescription, deterministic },
    requestId,
  );
  const sourceSnapshotJson = {
    jobDescription,
    metadata,
    importedFromJobsTable: Boolean(storedJob),
    capturedAt: new Date().toISOString(),
  };
  const values = {
    userId,
    workspaceId: workspace.id,
    type: "career_job",
    platform: input.platform || storedJob?.source || null,
    jobSourceId: input.jobSourceId || storedJob?.sourceJobId || null,
    companyName: companyName || null,
    jobTitle,
    jobUrl: input.jobUrl || storedJob?.careerPageUrl || storedJob?.sourceUrl || null,
    applicationUrl: input.applicationUrl || storedJob?.applicationUrl || null,
    atsVendor: input.atsVendor || storedJob?.atsVendor || null,
    sourceSnapshotJson,
    requirementsJson: requirements,
    fingerprint: targetFingerprint({ type: "career_job", jobTitle, companyName, jobDescription }),
  };
  return targetResponse(await createTarget(values));
}

export async function createManualTarget(userId, input, requestId) {
  const workspace = await ensureWorkspace(userId, requestId);
  const deterministic = buildExactTarget({
    type: "manual_jd",
    jobTitle: input.jobTitle,
    companyName: input.companyName,
    jobDescription: input.jobDescription,
    platform: input.platform,
    atsVendor: input.atsVendor,
  });
  const requirements = await resumeAgentModelGateway.extractTarget({
    jobTitle: input.jobTitle,
    companyName: input.companyName,
    jobDescription: input.jobDescription,
    deterministic,
  }, requestId);
  const values = {
    userId,
    workspaceId: workspace.id,
    type: "manual_jd",
    platform: input.platform || null,
    companyName: input.companyName || null,
    jobTitle: input.jobTitle,
    jobUrl: input.jobUrl || null,
    applicationUrl: input.applicationUrl || null,
    atsVendor: input.atsVendor || null,
    sourceSnapshotJson: { jobDescription: input.jobDescription, capturedAt: new Date().toISOString() },
    requirementsJson: requirements,
    fingerprint: targetFingerprint({ type: "manual_jd", ...input }),
  };
  return targetResponse(await createTarget(values));
}
