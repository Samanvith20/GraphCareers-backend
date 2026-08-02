/**
 * Phase 6A: Patch Engine Core
 * Responsibilities:
 * - Validate target paths
 * - Apply partial JSON patches
 * - Preserve untouched sections
 * - Ensure immutability (returns new JSON object)
 * - Collect errors without stopping the pipeline
 */

const VALID_ROOT_PATHS = [
  "summary",
  "headline",
  "skills",
  "education",
  "certifications"
];

const ARRAY_PATH_REGEX = /^(experience|projects)\[(\d+)\](?:\.bullets\[(\d+)\])?$/;

/**
 * Extracts a specific fragment of the JSON using the target path.
 */
export function getFragmentByPath(resumeJson, targetPath) {
  if (VALID_ROOT_PATHS.includes(targetPath)) return resumeJson[targetPath];
  
  const match = targetPath.match(ARRAY_PATH_REGEX);
  if (match) {
    const section = match[1];
    const index = parseInt(match[2], 10);
    const bulletIndex = match[3] ? parseInt(match[3], 10) : null;
    
    if (bulletIndex !== null) {
      return resumeJson[section][index].bullets[bulletIndex];
    } else {
      return resumeJson[section][index];
    }
  }
  return null;
}

/**
 * Validates if the target path is supported and exists in the current JSON.
 */
export function validateTargetPath(targetPath, resumeJson) {
  if (!targetPath) return false;
  if (VALID_ROOT_PATHS.includes(targetPath)) return true;

  const match = targetPath.match(ARRAY_PATH_REGEX);
  if (match) {
    const section = match[1]; // experience | projects
    const index = parseInt(match[2], 10);
    const bulletIndex = match[3] ? parseInt(match[3], 10) : null;

    // Check if section exists and is an array
    if (!Array.isArray(resumeJson[section])) return false;
    
    // Check if index is valid
    if (index < 0 || index >= resumeJson[section].length) return false;

    // Check bullet index if specified
    if (bulletIndex !== null) {
       const entry = resumeJson[section][index];
       if (!entry || !Array.isArray(entry.bullets)) return false;
       if (bulletIndex < 0 || bulletIndex >= entry.bullets.length) return false;
    }
    return true;
  }

  return false;
}

/**
 * Applies a single valid patch to the resume object in-place.
 * Internal utility.
 */
function applySinglePatch(resume, targetPath, updatedValue) {
  if (VALID_ROOT_PATHS.includes(targetPath)) {
    resume[targetPath] = updatedValue;
    return;
  }
  
  const match = targetPath.match(ARRAY_PATH_REGEX);
  if (match) {
    const section = match[1];
    const index = parseInt(match[2], 10);
    const bulletIndex = match[3] ? parseInt(match[3], 10) : null;
    
    if (bulletIndex !== null) {
      resume[section][index].bullets[bulletIndex] = updatedValue;
    } else {
      resume[section][index] = updatedValue;
    }
    return;
  }
  
  throw new Error(`Execution error: Unable to map path ${targetPath}`);
}

/**
 * Merges all patches deterministically into a new Resume JSON object.
 * 
 * @param {Object} originalResumeJson - The master resume state
 * @param {Array} patches - Array of { targetPath, updatedValue, operationId }
 * @returns {Object} { updatedResume, errors, appliedPatches }
 */
export function applyPatches(originalResumeJson, patches) {
  // Enforce Immutability: Deep clone the original JSON
  const result = JSON.parse(JSON.stringify(originalResumeJson));
  const errors = [];
  const appliedPatches = [];

  if (!Array.isArray(patches)) {
    return { updatedResume: result, errors: ["Patches payload must be an array"], appliedPatches };
  }

  for (const patch of patches) {
    try {
      if (!patch || typeof patch !== "object") {
         throw new Error("Malformed patch: must be an object");
      }
      
      const { targetPath, updatedValue, operationId } = patch;
      
      if (!targetPath) {
         throw new Error("Malformed patch: missing targetPath");
      }
      if (updatedValue === undefined) {
         throw new Error("Malformed patch: missing updatedValue");
      }

      if (!validateTargetPath(targetPath, result)) {
         throw new Error(`Invalid or unknown targetPath: ${targetPath}`);
      }

      // Safe to apply
      applySinglePatch(result, targetPath, updatedValue);
      appliedPatches.push({ targetPath, operationId });
      
    } catch (err) {
      errors.push({
         operationId: patch?.operationId || "unknown",
         targetPath: patch?.targetPath || "unknown",
         error: err.message
      });
    }
  }

  return { updatedResume: result, errors, appliedPatches };
}
