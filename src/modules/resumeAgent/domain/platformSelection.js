import { normalizeTerm, tokenize } from "./text.js";

const ROLE_TOKEN_ALIASES = new Map([
  ["developer", "engineer"],
  ["development", "engineer"],
  ["engineering", "engineer"],
  ["frontend", "front end"],
  ["backend", "back end"],
  ["fullstack", "full stack"],
]);

export function platformRoleSearchTokens(value) {
  return tokenize(value).flatMap((token) => (ROLE_TOKEN_ALIASES.get(token) || token).split(" "));
}

export function platformLocationSearchTokens(value) {
  return [...new Set(tokenize(value))];
}

function roleRecall(requestedRole, candidateRole) {
  const requested = new Set(platformRoleSearchTokens(requestedRole));
  const candidate = new Set(platformRoleSearchTokens(candidateRole));
  if (!requested.size || !candidate.size) return 0;
  let matched = 0;
  for (const token of requested) if (candidate.has(token)) matched += 1;
  return matched / requested.size;
}

function locationMatches(requestedLocation, candidate) {
  if (!requestedLocation) return true;
  const requested = normalizeTerm(requestedLocation);
  const primaryArea = normalizeTerm(String(requestedLocation).split(",")[0]);
  const available = normalizeTerm([
    candidate.location,
    candidate.locationState,
    candidate.locationCountry,
  ].filter(Boolean).join(" "));
  return Boolean(available && (
    available.includes(requested) ||
    requested.includes(available) ||
    (primaryArea && available.includes(primaryArea))
  ));
}

function postedTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function rankPlatformJobCandidates(candidates, { role, location, sampleSize, minimumReliableJobs = 5 }) {
  const roleMatches = candidates
    .map((job) => ({
      job,
      roleScore: roleRecall(role, `${job.roleTitle || ""} ${job.title || ""}`),
      locationMatch: locationMatches(location, job),
    }))
    .filter((entry) => entry.roleScore >= 0.34);

  const localMatches = roleMatches.filter((entry) => entry.locationMatch);
  const locationApplied = Boolean(location) && localMatches.length >= minimumReliableJobs;
  const selectedPool = locationApplied ? localMatches : roleMatches;
  const jobs = selectedPool
    .sort((left, right) => right.roleScore - left.roleScore || postedTimestamp(right.job.postedAt) - postedTimestamp(left.job.postedAt))
    .slice(0, sampleSize)
    .map((entry) => entry.job);

  return {
    jobs,
    metadata: {
      platformCandidateCount: candidates.length,
      roleCandidateCount: roleMatches.length,
      locationCandidateCount: localMatches.length,
      requestedLocation: location || null,
      locationApplied,
      locationFallback: Boolean(location) && !locationApplied,
    },
  };
}

export function platformSourceAliases(platform) {
  const normalized = normalizeTerm(platform).replaceAll(" ", "");
  const aliases = {
    naukri: ["naukri", "naukri.com"],
    instahyre: ["instahyre", "instahyre.com"],
    foundit: ["foundit", "foundit.in", "monster", "monsterindia"],
  };
  return aliases[normalized] || [normalizeTerm(platform)];
}
