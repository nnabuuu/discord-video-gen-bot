## 1. Database Schema

- [x] 1.1 Create migration for `user_api_keys` table with columns:
  - `id` (UUID, primary key)
  - `user_id` (VARCHAR, Discord user ID, unique)
  - `connection_code` (VARCHAR, unique, nullable - cleared after API key set)
  - `api_key` (VARCHAR, encrypted, nullable)
  - `created_at` (TIMESTAMPTZ)
  - `updated_at` (TIMESTAMPTZ)
  - `code_expires_at` (TIMESTAMPTZ, nullable)

## 2. User API Key Service

- [x] 2.1 Create `UserApiKeyService` with methods:
  - `generateConnectionCode(userId)` - creates/updates code, returns URL
  - `getApiKey(userId)` - returns decrypted API key or null
  - `setApiKey(code, apiKey)` - validates code, stores encrypted key
  - `removeApiKey(userId)` - deletes user's API key binding
  - `hasApiKey(userId)` - checks if user has bound API key

## 3. Discord Command

- [x] 3.1 Create `/api-key` command with subcommands:
  - `status`: Shows current binding status with masked key (e.g., `AIza...xxxx`)
  - `connect`: Generates connection URL (expires in 10 minutes)
  - `disconnect`: Removes API key binding
  - All responses are ephemeral (only visible to user)

- [x] 3.2 Register command in Discord module

## 4. Banana Command Modification

- [x] 4.1 Modify `/banana` to use free credits first, then user's API key:
  - If remaining quota > 0: use default API key (free credits)
  - If remaining quota = 0 AND has bound key: use user's API key
  - Footer shows "Using your API key" when using bound key

- [x] 4.2 Update banana service to accept optional API key parameter

## 5. HTTP API Endpoints (same project)

- [x] 5.1 Create `ConnectController` with endpoints:
  - `GET /api/connect?code=<code>` - Returns status (hasKey, maskedKey, connectedAt)
  - `POST /api/connect` with `{ code, apiKey }` - Binds new API key
  - `DELETE /api/connect?code=<code>` - Disconnects API key
  - All endpoints validate code exists and not expired
  - Returns appropriate JSON responses or error messages

## 6. Testing

- [x] 6.1 Unit tests for UserApiKeyService (18 tests passing)
- [ ] 6.2 Integration tests for connect/disconnect commands
- [ ] 6.3 Test rate limit bypass with user API key
