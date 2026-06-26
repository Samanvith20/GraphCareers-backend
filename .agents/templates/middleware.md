# Express Middleware Template

```javascript
import { logger } from "../logger/logger.js";

export const exampleMiddleware = async (req, res, next) => {
  try {
    const { requestId } = req;
    
    // Authorization or validation logic
    const token = req.headers.authorization;
    if (!token) {
      // Assuming a generic AppError utility exists based on conventions
      const err = new Error("Missing authorization header");
      err.statusCode = 401;
      throw err;
    }

    // Attach contextual state to the request object
    req.customContext = { verified: true };

    logger.debug("Middleware executed successfully", { requestId });
    next();
  } catch (err) {
    // Forward to the global error handler and Sentry hook
    next(err);
  }
};
```
