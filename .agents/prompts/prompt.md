this is the preivous prompt used for the neo4j queries  MATCH (j:Job)
          WHERE toLower(j.source) = $platform
            AND j.posted_at > datetime() - duration({days: 30})
            AND (
              (j.min_experience IS NULL AND j.max_experience IS NULL)
              OR (
                (j.min_experience IS NULL OR j.min_experience <= $maxExp)
                AND (j.max_experience IS NULL OR j.max_experience >= $minExp)
              )
            )
          MATCH (j)-[:REQUIRES]->(s:Skill)
          WITH j, collect(DISTINCT s.canonical) AS jobSkills
          WITH j, jobSkills, [sk IN jobSkills WHERE sk IN $skillVariants] AS matchedSkills
          WHERE size(matchedSkills) >= 2
          WITH j, size(matchedSkills) * 100.0 / size(jobSkills) AS matchPercent
          ORDER BY matchPercent DESC
          LIMIT 100
          RETURN j.job_id AS jobId
          `,
          {
            platform: platform.toLowerCase(),
            skillVariants,
            minExp: neo4j.int(Math.floor(minExp)),
            maxExp: neo4j.int(Math.ceil(maxExp)),
          },
          { timeout: 15000 }
        );