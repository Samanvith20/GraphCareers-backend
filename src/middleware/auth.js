import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

export async function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userArr = await db
      .select()
      .from(users)
      .where(users.id.eq(decoded.id))
      .limit(1);
    if (!userArr.length)
      return res.status(401).json({ error: "User not found" });
    req.user = {
      id: userArr[0].id,
      name: userArr[0].name,
      email: userArr[0].email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
