import jwt from "jsonwebtoken";


export async function authMiddleware(req, res, next) {
  //console.log("middleware called",req.cookies.token, req.headers.authorization)
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId=decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
