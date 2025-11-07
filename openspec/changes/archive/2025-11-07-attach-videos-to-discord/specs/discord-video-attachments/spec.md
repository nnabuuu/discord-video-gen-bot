# discord-video-attachments Specification

## Purpose
Enable Discord users to preview generated videos directly in chat messages by attaching video files instead of sending only GCS URLs, while managing bandwidth through concurrency limits.

## ADDED Requirements

### Requirement: Video File Attachment to Discord Messages
The system SHALL attach generated video files directly to Discord messages when file size permits, enabling inline video preview.

#### Scenario: Attach video under size limit
- **WHEN** video generation completes successfully
- **AND** video file size is ≤25MB
- **AND** concurrency slot is available
- **THEN** download video file from GCS to memory buffer
- **AND** create Discord `AttachmentBuilder` with video buffer
- **AND** attach video to Discord message using `files` parameter
- **AND** include completion embed with video metadata
- **AND** video displays inline with Discord's native player

#### Scenario: Fallback to URL for oversized video
- **WHEN** video generation completes successfully
- **AND** video file size is >25MB
- **THEN** skip download process
- **AND** send completion message with GCS public URL
- **AND** include warning: "⚠️ Video is too large for direct preview (>25MB). Click link to view."
- **AND** log oversized video metric for monitoring

#### Scenario: Download failure with graceful fallback
- **WHEN** attempting to download video from GCS
- **AND** download fails with error (network, auth, etc.)
- **THEN** log error with request context
- **AND** fall back to URL-only approach
- **AND** send completion message with GCS public URL
- **AND** include notice: "Video preview unavailable. View at URL."
- **AND** do not fail the user's request

### Requirement: File Size Validation
The system SHALL validate video file sizes against Discord attachment limits before downloading.

#### Scenario: Pre-download size check
- **WHEN** video generation completes
- **THEN** query GCS object metadata to get file size
- **AND** compare size to Discord limit (25MB = 26,214,400 bytes)
- **AND** proceed with download only if size ≤ limit
- **AND** execute size check within 500ms

#### Scenario: Multiple video files size handling
- **WHEN** generation produces multiple video files (sampleCount > 1)
- **AND** any file exceeds 25MB
- **THEN** fall back to URL-only approach for all files
- **AND** include message: "Multiple videos generated. Total size exceeds attachment limit."
- **AND** list all video URLs

#### Scenario: Size check metadata unavailable
- **WHEN** GCS metadata request fails or returns no size
- **THEN** log warning about missing metadata
- **AND** fall back to URL-only approach (safe default)
- **AND** do not attempt download without size confirmation

### Requirement: Concurrency Limiting for Downloads
The system SHALL limit concurrent video download/attachment operations to prevent bandwidth saturation.

#### Scenario: Acquire concurrency slot
- **WHEN** video is ready to attach to Discord
- **AND** fewer than 5 downloads are currently active
- **THEN** acquire concurrency slot immediately
- **AND** proceed with download process
- **AND** increment active download counter

#### Scenario: Wait for concurrency slot
- **WHEN** video is ready to attach to Discord
- **AND** 5 downloads are currently active (limit reached)
- **THEN** queue request for next available slot
- **AND** wait with timeout (30 seconds max)
- **AND** proceed with download when slot becomes available
- **AND** log queueing event with wait duration

#### Scenario: Concurrency timeout fallback
- **WHEN** waiting for concurrency slot
- **AND** wait time exceeds 30 seconds
- **THEN** log timeout warning
- **AND** fall back to URL-only approach
- **AND** send completion message with GCS URL
- **AND** include notice: "High server load. View video at URL."
- **AND** do not fail user request

#### Scenario: Release concurrency slot after completion
- **WHEN** download completes (success or failure)
- **OR** Discord message send completes
- **THEN** release concurrency slot immediately
- **AND** decrement active download counter
- **AND** notify next queued request if any
- **AND** ensure slot is released even on error (try-finally)

#### Scenario: Concurrency metrics logging
- **WHEN** acquiring or releasing concurrency slot
- **THEN** log current active download count
- **AND** log queue depth if requests are waiting
- **AND** log average wait time for queued requests

### Requirement: Memory Management for Video Buffers
The system SHALL manage memory efficiently when downloading and attaching video files.

#### Scenario: Download to memory buffer
- **WHEN** downloading video from GCS
- **THEN** stream file directly to memory buffer
- **AND** do not write to disk
- **AND** use Buffer for attachment payload

#### Scenario: Buffer cleanup after send
- **WHEN** Discord message with attachment is sent
- **OR** attachment process fails
- **THEN** clear video buffer reference immediately
- **AND** allow garbage collection
- **AND** ensure cleanup in error paths (try-finally)

#### Scenario: Prevent buffer accumulation
- **WHEN** multiple videos are processed sequentially
- **THEN** process one video at a time per request
- **AND** clean up buffer before processing next file
- **AND** do not accumulate buffers in memory

### Requirement: Discord Attachment API Integration
The system SHALL use Discord.js `AttachmentBuilder` correctly for video file attachments.

#### Scenario: Create attachment with proper metadata
- **WHEN** creating Discord attachment from video buffer
- **THEN** use `AttachmentBuilder` constructor with buffer
- **AND** set filename to original GCS filename (e.g., "video_001.mp4")
- **AND** preserve `.mp4` file extension for browser compatibility
- **AND** include attachment in `files` array parameter of `editReply`

#### Scenario: Attach video with completion embed
- **WHEN** sending Discord message with video attachment
- **THEN** include video file in `files` parameter
- **AND** include completion embed in `embeds` parameter
- **AND** do not include URL in `content` (video attachment replaces URL)
- **AND** preserve embed metadata (duration, ratio, resolution, rate limit info)

#### Scenario: Multiple video attachments
- **WHEN** generation produces multiple videos (sampleCount > 1)
- **AND** all files are ≤25MB individually
- **THEN** create `AttachmentBuilder` for each video
- **AND** include all attachments in `files` array
- **AND** verify total payload size does not exceed Discord limits
- **AND** fall back to URLs if combined size too large

### Requirement: Error Handling and Logging
The system SHALL handle attachment failures gracefully with comprehensive logging.

#### Scenario: Log attachment attempt
- **WHEN** attempting to attach video
- **THEN** log event with level "info"
- **AND** include fields: request_id, file_size, filename, queue_wait_ms
- **AND** log "Attaching video to Discord message"

#### Scenario: Log attachment success
- **WHEN** video attachment successfully sent to Discord
- **THEN** log event with level "info"
- **AND** include fields: request_id, file_size, download_duration_ms, total_duration_ms
- **AND** log "Video attached successfully"

#### Scenario: Log attachment failure
- **WHEN** attachment process fails at any stage
- **THEN** log event with level "warn" or "error"
- **AND** include fields: request_id, error_message, failure_stage (download|attach|size_check)
- **AND** include fallback action taken
- **AND** log "Video attachment failed, falling back to URL"

#### Scenario: Track attachment metrics
- **WHEN** video attachment completes (success or fallback)
- **THEN** log attachment method used ("attached" | "url_fallback")
- **AND** log reason for fallback if applicable (size|download_error|concurrency_timeout)
- **AND** enable monitoring of attachment success rate
