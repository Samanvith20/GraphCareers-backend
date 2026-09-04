import "dotenv/config";
import { resumeAgentModelGateway } from "../modules/resumeAgent/resumeAgent.modelGateway.js";

async function main() {
  const result = await resumeAgentModelGateway.proposeChanges({
    resume: {
      summary: "Backend developer experienced with Java and Spring Boot.",
      skills: { technical: ["Java", "Spring Boot"] },
      experience: [],
      projects: [],
      education: [],
    },
    target: {
      requiredSkills: [{ name: "Java", importance: "required" }],
      preferredSkills: [{ name: "Spring Boot", importance: "preferred" }],
      responsibilities: [],
      keywords: ["Backend Developer", "Java"],
      constraints: {},
      market: null,
      analysisConfidence: "high",
    },
    score: {
      overall: 70,
      atsCompatibility: { score: 90 },
      targetMatch: { score: 75 },
      resumeQuality: { score: 50 },
    },
  }, "provider-adapter-verification");

  process.stdout.write(`${JSON.stringify({
    success: true,
    provider: resumeAgentModelGateway.config.provider,
    model: resumeAgentModelGateway.config.model,
    proposalCount: result.proposals.length,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    success: false,
    error: error.message,
    statusCode: error.statusCode || null,
    retryable: error.isRetryable ?? null,
  })}\n`);
  process.exitCode = 1;
});
