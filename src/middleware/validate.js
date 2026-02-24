import { ZodError } from "zod";

export function validate(schema) {
  return (req, res, next) => {
    try {
      //console.log("Validating request body:", req.body);

      // IMPORTANT: overwrite req.body with parsed result
      req.body = schema.parse(req.body);

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: err.flatten(),
        });
      }
      return res.status(400).json({ error: "Invalid request" });
    }
  };
}