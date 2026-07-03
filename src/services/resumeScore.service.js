export function scoreResume({ resumeText, structuredJson, platform, trends, experienceMonths }) {
  if (!resumeText) return { total: 0, keywordMatch: 0, experienceMatch: 0, formatting: 0 };
  
  const textLower = resumeText.toLowerCase();

  // 1. Keyword Match (0-100)
  // Evaluates how many of the top 15 platform skills are present in the candidate's resume
  let keywordScore = 0;
  if (trends && trends.topSkills && trends.topSkills.length > 0) {
    const top15 = trends.topSkills.slice(0, 15);
    let matchedCount = 0;
    
    top15.forEach(skillObj => {
      if (textLower.includes(skillObj.skill.toLowerCase())) {
         matchedCount += 1;
      }
    });
    
    keywordScore = Math.round((matchedCount / top15.length) * 100);
  } else {
    keywordScore = 50; // Neutral default if no trends available
  }

  // 2. Experience Match (0-100)
  // Matches user's experience with the average minimum experience required for these jobs
  let experienceScore = 50;
  if (trends && trends.avgMinExp !== undefined) {
     const expYears = (experienceMonths || 0) / 12;
     const diff = Math.abs(expYears - trends.avgMinExp);
     
     if (diff <= 1) experienceScore = 100;
     else if (diff <= 2) experienceScore = 80;
     else if (diff <= 4) experienceScore = 60;
     else experienceScore = 40;
  }

  // 3. Formatting & Completeness Match (0-100)
  // Ensures the resume parses into complete core sections
  let formattingScore = 0;
  let conditionsMet = 0;
  const totalConditions = 5;
  
  if (structuredJson) {
     if (structuredJson.contact && (structuredJson.contact.email || structuredJson.contact.phone)) conditionsMet++;
     if (structuredJson.summary && structuredJson.summary.length > 20) conditionsMet++;
     if (structuredJson.experience && structuredJson.experience.length > 0) conditionsMet++;
     if (structuredJson.skills && Object.keys(structuredJson.skills).some(k => structuredJson.skills[k].length > 0)) conditionsMet++;
     if (structuredJson.education && structuredJson.education.length > 0) conditionsMet++;
     
     formattingScore = Math.round((conditionsMet / totalConditions) * 100);
  }

  // 4. Total calculation (Weighted: 50% keyword, 30% experience, 20% formatting)
  const total = Math.round((keywordScore * 0.5) + (experienceScore * 0.3) + (formattingScore * 0.2));

  return {
    total,
    keywordMatch: keywordScore,
    experienceMatch: experienceScore,
    formatting: formattingScore
  };
}

export function generateRecommendations({ trends, resumeText, structuredJson, platform }) {
  const recommendations = [];
  const textLower = resumeText.toLowerCase();

  // Keyword recommendations
  if (trends && trends.topSkills && trends.topSkills.length > 0) {
    const top10 = trends.topSkills.slice(0, 10);
    const missing = top10.filter(s => !textLower.includes(s.skill.toLowerCase()));
    
    if (missing.length > 0) {
       const missingNames = missing.map(m => m.skill).join(", ");
       recommendations.push(`Consider adding missing high-demand skills for the ${platform} platform: ${missingNames}.`);
    } else {
       recommendations.push(`Great job! You have included all top 10 most demanded skills for this role.`);
    }
  }

  // Structural recommendations
  if (structuredJson) {
    if (!structuredJson.summary || structuredJson.summary.length < 30) {
       recommendations.push("Expand your professional summary to include more core keywords and impact statements.");
    }
    
    if (structuredJson.experience && structuredJson.experience.length > 0) {
       let weakBullets = false;
       structuredJson.experience.forEach(exp => {
          if (exp.bullets && exp.bullets.some(b => b.length < 40)) {
             weakBullets = true;
          }
       });
       if (weakBullets) {
          recommendations.push("Some experience bullet points are too short. Expand them with specific quantifiable metrics (e.g., percentages, scale).");
       }
    } else {
       recommendations.push("Add at least one professional experience entry to improve your ATS score.");
    }
  }

  return recommendations;
}
