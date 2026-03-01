
import crypto from "crypto";

export const fingerprintMiddleware = (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  const lang = req.headers["accept-language"] || "";
  const accept = req.headers["accept"] || "";

  const raw = `${ua}|${lang}|${accept}`;

  req.fingerprint = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex");

  next();
};