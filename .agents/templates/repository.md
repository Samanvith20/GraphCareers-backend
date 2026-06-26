# Drizzle Repository Template

```javascript
import { db } from "../db/index.js";
import { exampleTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Standard fetch operation.
 */
export const findExampleById = async (id) => {
  const [record] = await db
    .select()
    .from(exampleTable)
    .where(eq(exampleTable.id, id))
    .limit(1);
    
  return record || null;
};

/**
 * Idempotent upsert operation.
 * Accepts an optional transaction object (tx) to participate in multi-table scopes.
 */
export const upsertExample = async (data, tx = db) => {
  const [record] = await tx
    .insert(exampleTable)
    .values(data)
    .onConflictDoUpdate({
      target: exampleTable.uniqueKey, // Explicit conflict target
      set: data,
    })
    .returning();
    
  return record;
};
```
