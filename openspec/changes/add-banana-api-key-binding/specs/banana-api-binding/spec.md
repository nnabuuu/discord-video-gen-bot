## ADDED Requirements

### Requirement: API Key Management Command
The system SHALL provide a single `/api-key` command with subcommands to manage user API key bindings.

#### Scenario: User checks API key status (no key bound)
- **WHEN** user runs `/api-key status`
- **AND** user has no API key bound
- **THEN** return ephemeral message: "No API key connected. Use `/api-key connect` to bind your Gemini API key."

#### Scenario: User checks API key status (key bound)
- **WHEN** user runs `/api-key status`
- **AND** user has API key bound
- **THEN** return ephemeral message showing masked key: "API key connected: `AIza...xxxx`"
- **AND** show when the key was connected

#### Scenario: User requests connection code
- **WHEN** user runs `/api-key connect`
- **THEN** generate UUID v4 as connection code
- **AND** store code in `user_api_keys` table with user_id
- **AND** set code_expires_at to current time + 10 minutes
- **AND** return ephemeral message with URL: `{BASE_URL}/connect?code=<code>`

#### Scenario: User already has bound API key and requests new connection
- **WHEN** user runs `/api-key connect`
- **AND** user already has API key bound
- **THEN** generate new connection code (allows key replacement)
- **AND** inform user that connecting a new key will replace existing one

#### Scenario: User disconnects API key
- **WHEN** user runs `/api-key disconnect`
- **AND** user has bound API key
- **THEN** delete user's API key from database
- **AND** return ephemeral confirmation: "API key disconnected successfully."

#### Scenario: User disconnects without bound key
- **WHEN** user runs `/api-key disconnect`
- **AND** user has no bound API key
- **THEN** return ephemeral message: "No API key is connected to your account."

### Requirement: API Key Management Web Page
The system SHALL serve a web page for users to manage their API key bindings.

#### Scenario: User opens connection page
- **WHEN** user opens `GET /connect?code=<code>`
- **AND** code is valid
- **THEN** return HTML page showing:
  - Current API key status (connected with masked key, or not connected)
  - Form to submit new API key
  - Disconnect button (if key is bound)

#### Scenario: Connection page with invalid code
- **WHEN** user opens `GET /connect?code=<invalid>`
- **THEN** return error page explaining the code is invalid or expired

### Requirement: API Key Management HTTP Endpoints
The system SHALL provide HTTP endpoints for the web page to manage API keys.

#### Scenario: Get current status via web
- **WHEN** web page calls `GET /api/connect?code=<code>`
- **AND** code is valid and not expired
- **THEN** return JSON with:
  - `hasKey`: boolean
  - `maskedKey`: string or null (e.g., "AIza...xxxx")
  - `connectedAt`: ISO timestamp or null

#### Scenario: Submit new API key via web
- **WHEN** web page calls `POST /api/connect` with `{ code, apiKey }`
- **AND** code is valid and not expired
- **THEN** encrypt API key using AES-256-GCM
- **AND** store encrypted key in user_api_keys table
- **AND** update updated_at timestamp
- **AND** return `{ success: true, maskedKey: "AIza...xxxx" }`

#### Scenario: Disconnect API key via web
- **WHEN** web page calls `DELETE /api/connect?code=<code>`
- **AND** code is valid and not expired
- **AND** user has bound API key
- **THEN** remove API key from database (set to null)
- **AND** return `{ success: true }`

#### Scenario: Connection code expired
- **WHEN** any endpoint is called with expired code
- **THEN** return HTTP 400 with error: "Connection code has expired. Please run /api-key connect again."

#### Scenario: Invalid connection code
- **WHEN** any endpoint is called with non-existent code
- **THEN** return HTTP 404 with error: "Invalid connection code"

### Requirement: API Key Retrieval
The system SHALL retrieve and decrypt user Gemini API keys for use in `/banana` image generation requests.

#### Scenario: User has bound API key
- **WHEN** calling `getApiKey(userId)`
- **AND** user has encrypted API key stored
- **THEN** decrypt API key using AES-256-GCM
- **AND** return decrypted API key

#### Scenario: User has no API key
- **WHEN** calling `getApiKey(userId)`
- **AND** user has no record or api_key_encrypted is null
- **THEN** return null


### Requirement: Encryption Configuration
The system SHALL require encryption configuration for API key storage.

#### Scenario: Encryption key configured
- **WHEN** application starts
- **AND** `API_KEY_ENCRYPTION_SECRET` environment variable is set
- **THEN** use this secret for AES-256-GCM encryption/decryption

#### Scenario: Encryption key missing
- **WHEN** application starts
- **AND** `API_KEY_ENCRYPTION_SECRET` is not set
- **THEN** log warning: "API key encryption disabled - user API keys will not work"
- **AND** disable user API key functionality (all getApiKey calls return null)
