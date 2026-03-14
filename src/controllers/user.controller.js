import logger from "../logger/logger.js";
import {
  getUserJobApplicationsService,
  getUserProfileService,
  updateUserProfileService,
  uploadResumeService,
} from "../services/user.service.js";

export async function getUserdetails(req, res) {
  try {
    const result = await getUserProfileService(req.userId);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    logger.info("user profile fetched success", {
      requestId: req.requestId,
    });
    return res.json({
      profile: result.profile,
      resume: result.resume,
      applications: result.applicationsCount,
    });
  } catch (err) {
    logger.error("PROFILE CONTROLLER ERROR ", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
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
      Object.entries(req.body).filter(([_, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        message: "No fields provided for update",
      });
    }

    const updatedUser = await updateUserProfileService(userId, updateData);
    logger.info("update user profile", {
      requestId: req.requestId,
    });
    return res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    logger.error("PROFILE UPDATE CONTROLLER ERROR", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
};

export async function uploadUserResume(req, res) {
  try {
    const userId = req.userId;
    const file = req.file;
    const requestId = req.requestId;

    const result = await uploadResumeService(userId, file, requestId);
    logger.info("user resume uploaded succeddfully", {
      requestId: req.requestId,
      userId: userId,
    });
    return res.json({
      success: true,
      message: "Resume uploaded & text extracted",
      textLength: result.textLength,
    });
  } catch (err) {
    logger.error("RESUME UPLOAD ERROR ", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(err.status || 500).json({
      error: err.message || "Failed to upload resume",
    });
  }
}

// export async function parseUserResumeWithAI(req, res) {
//   try {
//     const userId = req.userId

//     const data = await parseResumeWithAIService(userId);
//       logger.info("resume parsing with ai compeletd successfully",{
//               requestId:req.requestId

//       })
//     return res.json({
//       success: true,
//       data,
//     });
//   } catch (err) {
//     logger.error("RESUME AI PARSE ERROR ", {
//       requestId: req.requestId,
//       error: err.message,
//       stack: err.stack,
//     });
//     return res.status(err.status || 500).json({
//       error: err.message || "Failed to parse resume",
//     });
//   }
// }
