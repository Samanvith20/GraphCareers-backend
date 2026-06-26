# Create Background Job

**Description:** Use this prompt to offload heavy synchronous tasks (like AI integrations or parsing) to the BullMQ asynchronous queue.

**Prompt:**

```text
I need to implement a new asynchronous background job to handle: [Insert Job Description, e.g., 'extracting structured data from a user-uploaded PDF resume via OpenRouter'].

Please invoke the `queue-worker-builder` skill to design this integration:
1. Define the new BullMQ queue in `src/queue/`.
2. Write the worker execution loop in `src/workers/`. 
3. The worker must extract `requestId` from the job payload and use it in all Winston logs.
4. Crucially, write a `finally` block to delete any ephemeral files from `/app/uploads` once processing completes or fails.
5. Ensure Sentry hooks are attached to the `"failed"` event.

Show me the configuration and the worker logic, ensuring concurrency limits are explicitly capped.
```
