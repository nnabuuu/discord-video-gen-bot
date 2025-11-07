# Request Tracking Spec Delta

## ADDED Requirements

### Requirement: Request Lifecycle Persistence
The system SHALL persist all video generation requests with full lifecycle tracking from creation to completion.

#### Scenario: Request creation on command invoke
- **WHEN** user invokes `/veo` command with valid parameters
- **AND** passes rate limit validation
- **THEN** insert new record into `video_requests` table with status `pending`
- **AND** store Discord context (user_id, guild_id, channel_id)
- **AND** store generation parameters (prompt, duration, aspect ratio, resolution, audio)
- **AND** set `created_at` to current timestamp
- **AND** return generated request UUID

#### Scenario: Status transition to generating
- **WHEN** Vertex AI operation successfully starts
- **THEN** update request status to `generating`
- **AND** store `operation_name` from Vertex AI response
- **AND** set `started_at` to current timestamp
- **AND** store `gcs_prefix` for output files

#### Scenario: Successful completion
- **WHEN** video generation completes successfully
- **AND** public URLs are generated
- **THEN** update request status to `completed`
- **AND** store array of `video_urls`
- **AND** set `completed_at` to current timestamp
- **AND** calculate `duration_ms` as (completed_at - started_at)

#### Scenario: Generation failure
- **WHEN** video generation fails with error
- **THEN** update request status to `failed`
- **AND** store `error_message` with sanitized error details
- **AND** set `completed_at` to current timestamp
- **AND** calculate `duration_ms` for partial execution time

#### Scenario: Generation timeout
- **WHEN** polling operation exceeds 5-minute timeout
- **THEN** update request status to `timeout`
- **AND** store error_message "Generation timed out after 5 minutes"
- **AND** set `completed_at` to current timestamp

### Requirement: Request Status State Machine
The system SHALL enforce valid status transitions and prevent invalid state changes.

#### Scenario: Valid status transitions
- **GIVEN** a request with current status
- **WHEN** updating to new status
- **THEN** allow transition if it follows valid state machine:
  - `pending` → `generating` ✓
  - `generating` → `completed` ✓
  - `generating` → `failed` ✓
  - `generating` → `timeout` ✓
- **AND** reject any other transitions

#### Scenario: Invalid status transition attempt
- **WHEN** attempting to transition from `completed` to `generating`
- **THEN** log warning about invalid transition
- **AND** do not update database
- **AND** throw error with message "Invalid status transition"

#### Scenario: Idempotent status updates
- **WHEN** updating request to same status as current
- **THEN** allow update (no-op)
- **AND** update `completed_at` timestamp if applicable

### Requirement: Timing Metrics Collection
The system SHALL collect accurate timing metrics for all generation requests.

#### Scenario: Request latency tracking
- **WHEN** request completes (any terminal status)
- **THEN** calculate `duration_ms` as milliseconds between `started_at` and `completed_at`
- **AND** store duration in database
- **AND** log timing metric with labels (status, duration_seconds, aspect_ratio)

#### Scenario: Queueing time measurement
- **WHEN** request transitions from pending to generating
- **THEN** calculate queueing_time as (started_at - created_at)
- **AND** log queueing metric for monitoring

### Requirement: Query Interface for Request History
The system SHALL provide methods to query request history for analytics and debugging.

#### Scenario: Query user request history
- **WHEN** retrieving requests for specific user_id
- **THEN** return all requests ordered by created_at DESC
- **AND** include pagination support (limit, offset)
- **AND** filter by status if specified
- **AND** execute query within 100ms for up to 10,000 user requests

#### Scenario: Query guild statistics
- **WHEN** retrieving aggregate statistics for guild_id
- **THEN** return count of requests by status
- **AND** return average duration_ms for completed requests
- **AND** return most common prompts (top 10)
- **AND** group by time bucket (day, week, month)

#### Scenario: Global status dashboard
- **WHEN** querying overall system statistics
- **THEN** return count of requests by status in last 24 hours
- **AND** return P50, P95, P99 latency for completed requests
- **AND** return failure rate percentage
- **AND** execute query within 500ms

### Requirement: Request Data Retention
The system SHALL store request data with consideration for storage growth and privacy.

#### Scenario: Unlimited retention by default
- **WHEN** no retention policy is configured
- **THEN** store all requests indefinitely
- **AND** rely on database storage capacity

#### Scenario: Optional automated cleanup
- **WHEN** `REQUEST_RETENTION_DAYS` environment variable is set
- **THEN** schedule daily cleanup job
- **AND** delete requests older than specified days
- **AND** log count of deleted records

### Requirement: Error Recovery and Data Integrity
The system SHALL handle database errors gracefully without losing critical request state.

#### Scenario: Database unavailable during request creation
- **WHEN** database is unreachable when creating request
- **THEN** log error with full context
- **AND** allow video generation to proceed (graceful degradation)
- **AND** return synthetic request ID for tracking
- **AND** do not fail user request

#### Scenario: Database unavailable during status update
- **WHEN** database is unreachable when updating status
- **THEN** log error with request context
- **AND** allow operation to complete
- **AND** do not retry update (idempotent, can be backfilled)

#### Scenario: Duplicate request creation
- **WHEN** attempting to create request with same UUID
- **THEN** catch unique constraint violation
- **AND** log warning about duplicate
- **AND** use existing request ID

### Requirement: Structured Logging Integration
The system SHALL log all request tracking operations with structured metadata.

#### Scenario: Request creation logging
- **WHEN** request is created in database
- **THEN** log event with level "info"
- **AND** include fields: request_id, user_id, guild_id, prompt_length, parameters
- **AND** sanitize prompt (log first 50 chars only)

#### Scenario: Status transition logging
- **WHEN** request status is updated
- **THEN** log event with level "info"
- **AND** include fields: request_id, old_status, new_status, duration_ms
- **AND** include error_message if status is failed

#### Scenario: Query performance logging
- **WHEN** executing request history query
- **THEN** log query duration if exceeds 100ms
- **AND** include query type and parameter count
- **AND** warn if query duration exceeds 500ms
