## Why

Users hit the daily rate limit (5 images/day) on the `/banana` command and want to generate more. By allowing users to bind their own Gemini API key, they can bypass rate limits for image generation and pay for their own usage, while keeping the system secure through Discord user binding.

## What Changes

- Add `/api-key` command with subcommands: `status`, `connect`, `disconnect`
- Create new `user_api_keys` database table to store connection codes and API keys
- External service (app.anyint.ai) handles API key submission via the generated URL
- Modify `/banana` command to use user's API key when available (after free credits exhausted)

## Impact

- Affected specs: `rate-limiting` (modified), `banana-api-binding` (new capability)
- Affected code:
  - `src/discord/commands/api-key.command.ts` (new)
  - `src/discord/commands/banana.command.ts` (modified)
  - `src/database/user-api-key.service.ts` (new)
  - `src/banana/banana.service.ts` (modified)
  - `src/api/connect.controller.ts` (new)
  - Database migration for `user_api_keys` table
