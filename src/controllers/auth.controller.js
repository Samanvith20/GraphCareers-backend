import logger from "../logger/logger.js";
import {
  loginService,
  signupService,
  forgotPasswordService,
  profileService,
  resetPasswordService,
  googleAuthService,
} from "../services/auth.service.js";
import jwt from "jsonwebtoken";


export async function login(req, res,next) {
  try {
    logger.info("Login attempt", {
      requestId: req.requestId,
      email: req.body.email,
    });
    const { email, password } = req.body;

    const user = await loginService(email, password);

    

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    logger.info("Login success", {
      requestId: req.requestId,
    });

    return res.json({ user });
  } catch (err) {
    logger.error("Login controller failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err);

   // return res.status(500).json({ error: "Internal server error" });
  }
}

export async function signup(req, res,next) {
  try {
    logger.info("signup attempt ", {
      requestId: req.requestId,
      email: req.body.email,
    });
    const { name, email, password } = req.body;

    const user = await signupService(name, email, password);

    
    logger.info("user signup success", {
      requestId: req.requestId,
    });
    return res.status(201).json({ user });
  } catch (err) {
    logger.error("user signup failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err);
    //return res.status(500).json({ error: "Internal server error" });
  }
}

export const googleAuth = async (req, res,next) => {
  try {
    logger.info("googlesignupattempt",{
      requestId: req.requestId,
    })
    
    const { token } = req.body;
    

    const user = await googleAuthService(token);
 

   

    const jwtToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    logger.info("google login success",{
      requestId:req.requestId
    })

    return res.json({ user });

  } catch (err) {
    logger.error("google login failed",{
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    })
    next(err);

  }
};

export async function forgotPassword(req, res,next) {
  try {
    logger.info("forgot-password", {
      requestId: req.requestId,
      email: req.body,
    });
    const { email } = req.body;

     await forgotPasswordService(email);

    
    logger.info("forgotPassword success", {
      requestId: req.requestId,
    });

    return res.json({ message: "Password reset email sent" });
  } catch (err) {
    logger.error("forgot password failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err)
    //return res.status(500).json({ error: "Internal server error" });
  }
}

export async function resetPasswordController(req, res,next) {
  try {
    const { token, password } = req.body;

     await resetPasswordService(token, password);

   
    logger.info("resetpassword success", {
      requestId: req.requestId,
    });

    return res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (err) {
    logger.error("Reset password controller error", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err)

   // return res.status(500).json({ error: "Internal server error" });
  }
}
export async function me(req, res,next) {
  try {
    const user= await profileService(req.userId);
    
    logger.info("me controller success", {
      requestId: req.requestId,
    });
    return res.json({ user });
  } catch (err) {
    logger.error("ME CONTROLLER ERROR ", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err);
    //return res.status(500).json({ error: "Internal server error" });
  }
}
