import { AppError } from "../lib/AppError.js";

export const validate = (schema) => (req, res, next) => {
  try {
    //console.log("req.body",req.body)
    schema.parse(req.body); // Zod example
    next();
  } catch (err) {
    next(new AppError(err.errors?.[0]?.message || "Invalid input", 400));
  }
};