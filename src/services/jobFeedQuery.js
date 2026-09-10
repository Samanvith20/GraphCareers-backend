// The same eligibility clause is shared by count and listing queries.
export const preferenceWhere = `
  AND (size($desiredRoles) = 0 OR EXISTS {
    MATCH (j)-[:MAPS_TO]->(preferredRole:Role)
    WHERE toLower(trim(preferredRole.role_title)) IN $desiredRoles
  })
  AND (size($locations) = 0 OR any(location IN $locations WHERE
    toLower(coalesce(j.location, '')) CONTAINS location))
  AND (size($workModes) = 0 OR
    replace(replace(toLower(coalesce(j.work_mode, '')), '-', ''), ' ', '') IN $workModes)
  AND (size($employmentTypes) = 0 OR
    replace(replace(toLower(coalesce(j.job_type, '')), '-', ''), ' ', '') IN $employmentTypes)
`;

export function browseQueries(optionalWhere) {
  const eligible = `MATCH (j:Job)
    WHERE j.posted_at >= datetime($fromDate) AND j.expires_at > datetime()
      ${optionalWhere}
      AND ($experienceKnown = false OR
        ((j.min_experience IS NULL OR j.min_experience <= ($maxExp + 1))
        AND (j.max_experience IS NULL OR j.max_experience >= ($minExp - 1))))`;
  return {
    stats: `${eligible} RETURN count(j) AS totalJobs, 0 AS avgMatch, 0 AS perfectMatches,
      sum(CASE WHEN j.posted_at >= datetime($newJobsThreshold) THEN 1 ELSE 0 END) AS newJobs`,
    jobs: `${eligible}
      WITH j ORDER BY j.posted_at DESC, j.job_id ASC SKIP $skip LIMIT $limit
      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      WITH j, min(c.name) AS company
      OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)
      WITH j, company, min(r.role_title) AS role
      OPTIONAL MATCH (j)-[:REQUIRES]->(s:Skill)
      WITH j, company, role, collect(DISTINCT s.canonical) AS requiredSkills
      RETURN j.job_id AS jobId, j.title AS title, j.source_url AS url,
        company, j.location AS location, j.work_mode AS workMode, j.job_type AS jobType,
        j.source AS source, j.min_experience AS minExp, j.max_experience AS maxExp,
        j.posted_at AS postedAt, j.salary_min AS salaryMin, j.salary_max AS salaryMax,
        role, [] AS matchedSkills, [] AS missingSkills, requiredSkills,
        0 AS matchedCount, size(requiredSkills) AS totalRequired, null AS matchPercent, 0 AS qualityScore`,
  };
}
