# Service Template

Use this template when creating new business logic modules in GraphCareers.
It enforces strict database handling and decoupling from the HTTP transport layer.

### Key Rules Enforced:
1. Pure ESM imports (`.js`).
2. No `req` or `res` dependencies.
3. Drizzle `db.transaction()` for multi-table atomicity.
4. `AppError` thrown on constraint violations.

```javascript
// src/services/example.service.js
import { db } from "../db/index.js";
import { logger } from "../logger/logger.js";
// Note: Assuming a generic AppError utility exists based on conventions
// import { AppError } from "../utils/AppError.js"; 
import { users } from "../db/schema.js"; 
import { eq } from "drizzle-orm";

/**
 * Executes core business logic.
 * Throws AppError on operational violations so the controller can handle it.
 * 
 * @param {Object} data - The validated input payload.
 * @param {string} requestId - Context ID for distributed tracing.
 */
export const executeExampleLogic = async (data, requestId) => {
  logger.info("Executing example service logic", { requestId, action: "start" });

  // 1. Evaluate business constraints
  if (data.name === "restricted") {
    // throw new AppError("This name is not permitted", 400);
    throw new Error("This name is not permitted"); // Replace with AppError
  }

  // 2. Multi-table mutations must be wrapped in a transaction
  const result = await db.transaction(async (tx) => {
    
    // Example: Idempotent upsert ensuring no duplicate key errors
    const [insertedRecord] = await tx.insert(users)
      .values(data)
      .onConflictDoUpdate({
        target: users.id, // Replace with actual unique constraint
        set: data
      })
      .returning();

    // Additional database logic can occur here safely...
    
    return insertedRecord;
  });

  logger.debug("Example logic completed successfully", { requestId, recordId: result.id });
  
  return result;
};
```
