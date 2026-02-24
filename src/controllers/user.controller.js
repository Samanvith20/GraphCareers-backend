import {  getUserJobApplicationsService, getUserProfileService, parseResumeWithAIService, updateUserProfileService, uploadResumeService,  } from "../services/user.service.js";

export async function getUserdetails(req, res) {
  try {
    const result = await getUserProfileService(req.userId);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    return res.json({ profile: result.profile ,resume:result.resume,applications:result.applicationsCount});
  } catch (err) {
    console.error("PROFILE CONTROLLER ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
export async function getuserJobs(req, res) {
  try {
      const jobs = await getUserJobApplicationsService(req.userId);
  return res.json({ jobs });
  } catch (err) {
    console.error("PROFILE JOBS CONTROLLER ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}



export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.userId;

    

    
// Filter out undefined values to avoid overwriting existing data with undefined
    const updateData = Object.fromEntries(
  Object.entries(req.body).filter(
    ([_, value]) => value !== undefined
  )
);

if (Object.keys(updateData).length === 0) {
  return res.status(400).json({
    message: "No fields provided for update",
  });
}

    const updatedUser = await updateUserProfileService(userId, updateData);

    return res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("PROFILE UPDATE CONTROLLER ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export async function uploadUserResume(req, res) {
  try {
    const userId = req.userId;
    const file = req.file;

    const result = await uploadResumeService(userId, file);

    return res.json({
      success: true,
      message: "Resume uploaded & text extracted",
      textLength: result.textLength,
    });
  } catch (err) {
    console.error("RESUME UPLOAD ERROR 👉", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to upload resume",
    });
  }
}

export async function parseUserResumeWithAI(req, res) {
  try {
    const userId = req.userId

    const data = await parseResumeWithAIService(userId);

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("RESUME AI PARSE ERROR 👉", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to parse resume",
    });
  }
}
