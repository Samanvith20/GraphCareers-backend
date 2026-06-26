# Controller Template

Use this template when scaffolding a new Express controller in GraphCareers.
It enforces the Controller-Service-Repository pattern, ensuring routing logic is kept separate from business rules.

### Key Rules Enforced:
1. Pure ESM imports (`.js`).
2. `try/catch` wrapper forwarding to `next(err)`.
3. Winston logger with `requestId`.
4. No direct database queries (Drizzle/Neo4j).

```javascript
// src/controllers/example.controller.js
import { z } from "zod";
import { logger } from "../logger/logger.js";
import * as exampleService from "../services/example.service.js";

// Optional: Define Zod validation schema to be used by the route middleware
export const exampleSchema = z.object({
  body: z.object({
    // Define expected payload structure here
    name: z.string().min(1),
  }),
});

/**
 * Handles the incoming HTTP request.
 * Must remain thin: Extract parameters -> Call Service -> Format JSON.
 */
export const handleExampleAction = async (req, res, next) => {
  try {
    // 1. Extract context
    const { requestId } = req;
    
    // 2. Extract validated data (assuming Zod middleware executed prior)
    const payload = req.body;
    
    logger.debug("Processing example action", { requestId });
    
    // 3. Delegate to business logic service (passing primitive data, NEVER req/res)
    const result = await exampleService.executeExampleLogic(payload, requestId);
    
    // 4. Return standard JSON response
    res.status(200).json({
      success: true,
      data: result,
      requestId,
    });
  } catch (err) {
    // DO NOT swallow errors. Always forward to the global handler.
    next(err);
  }
};
```
