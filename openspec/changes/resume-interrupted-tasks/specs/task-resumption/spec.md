# task-resumption Specification

## Purpose
Enable the Discord bot to automatically resume interrupted video generation requests after restart, ensuring users receive their videos even if the bot crashes or redeploys during generation.

## ADDED Requirements

### Requirement: Query Incomplete Requests on Startup
The system SHALL query and identify all incomplete video generation requests when the bot initializes.

#### Scenario: Fetch pending and generating requests
- **WHEN** bot starts up (Discord client ready event)
- **THEN** query database for requests with status `pending` OR `generating`
- **AND** exclude requests older than 24 hours
- **AND** order results by `created_at` ASC (oldest first for FIFO)
- **AND** log count of pending and generating requests found

#### Scenario: No incomplete requests on startup
- **WHEN** bot starts up
- **AND** database has no requests with status `pending` or `generating`
- **THEN** log "No incomplete requests to resume"
- **AND** proceed with normal bot initialization

#### Scenario: Database unavailable on startup
- **WHEN** bot starts up
- **AND** database query fails
- **THEN** log error "Failed to query incomplete requests"
- **AND** continue bot initialization (graceful degradation)
- **AND** do not block bot from becoming ready

### Requirement: Resume Pending Requests
The system SHALL restart video generation for requests that never began processing.

#### Scenario: Resume pending request within interaction window
- **WHEN** resuming pending request
- **AND** request age <15 minutes
- **THEN** attempt to retrieve original Discord interaction context
- **AND** restart video generation using original parameters from database
- **AND** update status to `generating`
- **AND** use interaction for progress updates if available

#### Scenario: Resume pending request after interaction expiry
- **WHEN** resuming pending request
- **AND** request age ≥15 minutes
- **THEN** create standalone generation context (no interaction)
- **AND** restart video generation using original parameters from database
- **AND** update status to `generating`
- **AND** send completion message to channel when done

#### Scenario: Resume pending request with channel access
- **WHEN** resuming pending request
- **THEN** verify bot has access to channel_id from database
- **AND** if no access, log warning and mark request as failed
- **AND** error message: "Cannot access channel for completion notification"

### Requirement: Resume Generating Requests
The system SHALL continue polling Vertex AI operations for requests that were mid-generation.

#### Scenario: Resume generating with operation still running
- **WHEN** resuming generating request
- **AND** Vertex AI operation exists and is still running
- **THEN** resume polling operation using stored `operation_name`
- **AND** continue progress tracking
- **AND** send completion message to channel when operation completes

#### Scenario: Resume generating with operation completed
- **WHEN** resuming generating request
- **AND** Vertex AI operation exists and has completed
- **THEN** fetch operation result immediately
- **AND** process generated video files
- **AND** update database status to `completed`
- **AND** send completion message to channel with video attachment

#### Scenario: Resume generating with operation expired
- **WHEN** resuming generating request
- **AND** Vertex AI operation does not exist (404 or expired)
- **THEN** log "Operation expired" with request context
- **AND** update database status to `timeout`
- **AND** send failure message to channel: "Video generation timed out during bot restart"

#### Scenario: Resume generating with operation failed
- **WHEN** resuming generating request
- **AND** Vertex AI operation exists and has error status
- **THEN** update database status to `failed`
- **AND** store error message from Vertex AI
- **AND** send failure message to channel

### Requirement: Discord Notification for Resumed Tasks
The system SHALL notify users in Discord when resumed requests complete.

#### Scenario: Send completion message to channel
- **WHEN** resumed request completes successfully
- **THEN** send message to stored `channel_id`
- **AND** include embed with video details (prompt, duration, ratio)
- **AND** attach video file if size ≤25MB
- **AND** include footer: "Resumed after bot restart"
- **AND** mention original user with user_id

#### Scenario: Send failure message to channel
- **WHEN** resumed request fails or times out
- **THEN** send message to stored `channel_id`
- **AND** include error reason
- **AND** mention original user with user_id
- **AND** suggest retry with new `/veo` command

#### Scenario: Channel no longer accessible
- **WHEN** attempting to send completion message
- **AND** bot lacks permission to send messages in channel
- **THEN** log warning with channel_id and guild_id
- **AND** update database request status appropriately
- **AND** do not crash or halt resume process

### Requirement: Resume Task Prioritization
The system SHALL prioritize resumed tasks over new user requests.

#### Scenario: Process resumed tasks before accepting new commands
- **WHEN** bot is resuming incomplete requests
- **THEN** queue is populated with resumed tasks sorted by `created_at`
- **AND** new `/veo` commands are queued after resumed tasks
- **AND** resumed tasks process in FIFO order by original timestamp

#### Scenario: Concurrent resume processing
- **WHEN** resuming multiple requests
- **THEN** process up to 3 requests concurrently
- **AND** respect rate limits and Vertex AI quotas
- **AND** log progress every 5 requests

#### Scenario: Resume process timeout protection
- **WHEN** resume process is running
- **AND** a single request takes >10 minutes
- **THEN** log timeout warning
- **AND** mark that request as timeout
- **AND** continue processing next resumed request
- **AND** do not block entire resume process

### Requirement: Resume Process Logging and Metrics
The system SHALL provide comprehensive logging for the resume process.

#### Scenario: Log resume process start
- **WHEN** bot starts resume process
- **THEN** log with level "info"
- **AND** include fields: pending_count, generating_count, total_count
- **AND** message: "Starting resume process for interrupted requests"

#### Scenario: Log individual request resume
- **WHEN** resuming a specific request
- **THEN** log with level "info"
- **AND** include fields: request_id, user_id, status, age_minutes
- **AND** message: "Resuming request"

#### Scenario: Log resume process completion
- **WHEN** all incomplete requests are processed
- **THEN** log with level "info"
- **AND** include fields: completed_count, failed_count, timeout_count, total_duration_ms
- **AND** message: "Resume process completed"

#### Scenario: Log resume errors
- **WHEN** error occurs during resume of specific request
- **THEN** log with level "error"
- **AND** include fields: request_id, error_message, stack_trace
- **AND** do not throw exception (continue with next request)

### Requirement: Age-Based Request Handling
The system SHALL handle requests differently based on their age.

#### Scenario: Mark very old pending requests as expired
- **WHEN** pending request is >24 hours old
- **THEN** do not resume generation
- **AND** update status to `timeout`
- **AND** update error_message to "Request expired (>24 hours old)"
- **AND** log expiration event

#### Scenario: Resume recent pending requests
- **WHEN** pending request is ≤24 hours old
- **THEN** resume generation normally
- **AND** process with appropriate priority

#### Scenario: Check generating requests regardless of age
- **WHEN** generating request has operation_name
- **THEN** attempt to poll Vertex AI operation regardless of age
- **AND** if operation still exists, resume polling
- **AND** if operation expired, mark as timeout
