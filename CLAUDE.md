# Build & Coding Workflow

When building or modifying code:

1. **Write the tests first**
   - Define the expected behaviour before writing the implementation.
   - Use the tests to verify the build rather than relying only on visual inspection.
2. **Use Haiku for the implementation/build first**
   - Haiku should be the default model for coding/build tasks where practical.
   - Keep token usage and cost as low as reasonably possible.
3. **If Haiku fails**
   - First assess whether the failure can be fixed simply.
   - If Haiku cannot complete the task successfully, retry the build using Sonnet.
4. **If Sonnet also fails**
   - I can take over and complete the work myself.
   - Do not repeatedly retry the same failed approach and waste tokens.
5. **Testing**
   - After building, run the relevant tests.
   - If tests fail, diagnose the failure and fix it using the same escalation path where practical.
6. **Keep me informed while working**
   - Where possible, show short progress updates directly in the chat so I can see what is happening.
   - Keep updates brief and useful, for example:
     - `Haiku building...`
     - `Build complete — now testing...`
     - `Tests failed — Haiku attempting a fix...`
     - `Haiku failed — switching to Sonnet...`
     - `Tests passing — build complete.`

## Main principle

Use the cheapest/simplest approach that reliably gets the job done.

Do not use a more capable model unnecessarily. Keep token usage down, but do not sacrifice correctness just to save tokens.
