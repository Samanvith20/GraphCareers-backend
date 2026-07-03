import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";
import {
  getUserProfileService,
  updateUserProfileService,
  uploadResumeService,
} from "../services/user.service.js";

export async function getUserdetails(req, res, next) {
  try {
    const result = await getUserProfileService(req.userId);
    return res.json({
      profile: result.profile,
      resume: result.resume,
      applications: result.applicationsCount,
    });
  } catch (err) {
    next(err);
  }
}

export const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Filter out undefined values to avoid overwriting existing data with undefined
    const updateData = Object.fromEntries(
      Object.entries(req.body).filter(([_, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      throw new AppError("No Fields provided for update", 400);
    }

    const updatedUser = await updateUserProfileService(userId, updateData);

    logger.info("User profile updated", {
      requestId: req.requestId,
      userId,
      fields: Object.keys(updateData),
    });

    return res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export async function uploadUserResume(req, res, next) {
  try {
    const userId = req.userId;
    const file = req.file;
    const requestId = req.requestId;

    const result = await uploadResumeService(userId, file, requestId);

    logger.info("Resume uploaded and queued for parsing", {
      requestId,
      userId,
      fileName: file?.originalname,
      fileSizeBytes: file?.size,
    });

    return res.json({
      message: "Resume uploaded & processing started",
      status: result.status,
    });
  } catch (err) {
    next(err);
  }
}
