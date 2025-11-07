# Implementation Tasks: attach-videos-to-discord

## Task Order
Tasks are ordered to deliver user-visible progress incrementally, with testing after each major capability.

---

## 1. [x] Add concurrency limiter utility
**Deliverable:** Reusable semaphore class to limit concurrent operations

- Create `src/common/semaphore.ts` with `Semaphore` class
- Implement `acquire()` method with timeout support (30s default)
- Implement `release()` method with error safety (try-finally)
- Implement `runExclusive<T>(fn: () => Promise<T>)` helper for automatic release
- Add unit tests for semaphore behavior (acquire, release, timeout, queueing)

**Validation:**
- `npm test -- semaphore.spec.ts` passes
- Test covers: concurrent acquisition, timeout, error handling, queue FIFO order

---

## 2. [x] Add GCS file metadata and download methods to StorageService
**Deliverable:** Methods to get file size and download to buffer

- Add `getFileMetadata(objectName: string): Promise<{ size: number }>` method
  - Query GCS file metadata using `bucket.file(objectName).getMetadata()`
  - Return size in bytes
  - Handle errors (file not found, auth failure)
- Add `downloadToBuffer(objectName: string): Promise<Buffer>` method
  - Download file contents using `bucket.file(objectName).download()`
  - Return Buffer (not stream)
  - Handle errors (file not found, network failure)
- Add unit tests mocking GCS SDK calls

**Validation:**
- `npm test -- storage.service.spec.ts` passes
- Tests verify correct GCS API calls and error handling

---

## 3. [x] Create VideoAttachmentService with concurrency control
**Deliverable:** New service to orchestrate download, size check, and attachment with concurrency limiting

- Create `src/discord/video-attachment.service.ts`
- Inject `StorageService` dependency
- Initialize `Semaphore` with limit=5 for download concurrency
- Add method signature:
  ```typescript
  async attachVideoOrFallback(
    objectName: string,
    interaction: ChatInputCommandInteraction,
    embed: EmbedBuilder
  ): Promise<{ method: 'attached' | 'url'; reason?: string }>
  ```
- Implement core logic (no Discord API calls yet - just structure):
  - Check file size via `StorageService.getFileMetadata()`
  - If size >25MB, return early with fallback indicator
  - Acquire semaphore slot with timeout
  - Download file to buffer via `StorageService.downloadToBuffer()`
  - Return success indicator (actual Discord attachment in next task)
  - Ensure semaphore release in finally block
- Add error handling for each stage (size check, download, semaphore timeout)
- Add structured logging for each path

**Validation:**
- Service compiles without errors
- Constructor and method signatures verified via type checking

**Dependency:** Tasks 1 and 2 must be complete

---

## 4. [x] Integrate Discord AttachmentBuilder in VideoAttachmentService
**Deliverable:** Complete video attachment to Discord messages

- Import `AttachmentBuilder` from `discord.js`
- Update `attachVideoOrFallback()` to send Discord message:
  - Create `AttachmentBuilder` from buffer with filename
  - Call `interaction.editReply({ files: [attachment], embeds: [embed] })`
  - Handle Discord API errors gracefully
  - Log attachment success with file size and duration
- Add fallback paths:
  - On size >25MB: log reason, return `{ method: 'url', reason: 'size_exceeded' }`
  - On download failure: log error, return `{ method: 'url', reason: 'download_error' }`
  - On semaphore timeout: log timeout, return `{ method: 'url', reason: 'concurrency_timeout' }`
  - On Discord API failure: log error, return `{ method: 'url', reason: 'discord_error' }`

**Validation:**
- Service compiles and passes type checking
- Manual test: generate video, verify attachment appears in Discord

**Dependency:** Task 3 must be complete

---

## 5. [x] Update VeoCommand to use VideoAttachmentService
**Deliverable:** `/veo` command sends video attachments instead of URLs

- Inject `VideoAttachmentService` into `VeoCommand` constructor
- Update success path in `execute()` method (after line 213):
  - For single video (typical case):
    - Call `videoAttachmentService.attachVideoOrFallback(files[0], interaction, completionEmbed)`
    - Check result method
    - If `method === 'url'`: append warning message based on reason
    - If `method === 'attached'`: video already sent, no further action
  - For multiple videos (if sampleCount > 1 in future):
    - If any file >25MB: fall back to URL list for all
    - Otherwise: create array of AttachmentBuilder for all files
- Remove old URL-only message code (lines 245-250)
- Preserve embed metadata (duration, ratio, resolution, rate limit)
- Add logging for attachment method and fallback reasons

**Validation:**
- Code compiles without TypeScript errors
- `/veo` command returns attachment for small videos (<25MB)
- `/veo` command falls back to URL with warning for oversized videos

**Dependency:** Task 4 must be complete

---

## 6. [x] Add fallback warning messages to VeoCommand
**Deliverable:** User-friendly messages when video cannot be attached

- Update `attachVideoOrFallback()` result handling in VeoCommand:
  - If `reason === 'size_exceeded'`: add content "⚠️ Video is too large for direct preview (>25MB). Click link to view."
  - If `reason === 'download_error'`: add content "Video preview unavailable due to download error. View at URL."
  - If `reason === 'concurrency_timeout'`: add content "High server load. View video at URL."
  - If `reason === 'discord_error'`: add content "Video preview unavailable. View at URL."
- Include public URL in content when falling back
- Preserve embed in all cases

**Validation:**
- Test each fallback scenario (manually or via mocks)
- Verify warning messages appear correctly in Discord
- Verify URL is clickable

**Dependency:** Task 5 must be complete

---

## 7. [x] Add concurrency and attachment metrics logging
**Deliverable:** Observability for attachment system performance

- Add log events in VideoAttachmentService:
  - Before acquire: log "Waiting for download slot" with queue depth
  - After acquire: log "Acquired download slot" with wait duration
  - After download: log "Downloaded video" with file_size and download_duration_ms
  - After attachment: log "Attached video to Discord" with total_duration_ms
  - On fallback: log "Video attachment fallback" with method and reason
- Add log fields:
  - `request_id`, `file_size`, `download_duration_ms`, `queue_wait_ms`, `attachment_method`, `fallback_reason`
- Log concurrency metrics: active_downloads, queue_depth

**Validation:**
- Run `/veo` command and verify structured logs appear
- Verify logs include all required fields
- Test high concurrency scenario (>5 simultaneous commands) and verify queue logs

**Dependency:** Task 4 must be complete (can be parallel with tasks 5-6)

---

## 8. [x] Add unit tests for VideoAttachmentService
**Deliverable:** Test coverage for attachment logic

- Create `src/discord/video-attachment.service.spec.ts`
- Mock `StorageService` methods
- Test cases:
  - ✓ Successful attachment for file <25MB
  - ✓ Fallback to URL for file >25MB
  - ✓ Fallback on download error
  - ✓ Fallback on semaphore timeout
  - ✓ Semaphore release on success
  - ✓ Semaphore release on error (critical path)
  - ✓ Concurrency limiting (5 concurrent, 6th waits)
  - ✓ Correct logging for each path

**Validation:**
- `npm test -- video-attachment.service.spec.ts` passes
- Code coverage >80% for VideoAttachmentService

**Dependency:** Task 4 must be complete

---

## 9. [x] Update .env.example with concurrency config (optional)
**Deliverable:** Document concurrency limit configuration

- Add optional environment variable to .env.example:
  ```
  # Maximum concurrent video downloads/attachments (default: 5)
  # MAX_CONCURRENT_ATTACHMENTS=5
  ```
- Update VideoAttachmentService to read from env var with default:
  ```typescript
  const concurrencyLimit = parseInt(process.env.MAX_CONCURRENT_ATTACHMENTS || '5', 10);
  ```

**Validation:**
- Verify env var works when set
- Verify default (5) works when not set

**Dependency:** Task 3 must be complete

---

## 10. Manual end-to-end testing
**Deliverable:** Verified behavior in real Discord environment

- Test scenarios:
  1. **Normal case**: Generate 8-second video, verify inline attachment in Discord
  2. **Size check**: Generate HD video >25MB (extend duration or increase resolution), verify URL fallback with warning
  3. **Concurrency limit**: Trigger 6 `/veo` commands simultaneously, verify 5 proceed and 6th waits or falls back
  4. **Error handling**: Temporarily break GCS credentials, verify graceful fallback to URL
  5. **Multiple users**: Test from different Discord accounts to verify independent operation

- Validation checklist:
  - [ ] Video attachments display inline with Discord player
  - [ ] Oversized videos fall back to URL with warning
  - [ ] Concurrency limit prevents >5 simultaneous downloads
  - [ ] Errors don't crash bot or leave semaphore locked
  - [ ] Logs show clear attachment/fallback events

**Dependency:** All previous tasks must be complete

**Note:** Manual testing to be performed by user in production environment.

---

## Parallel Work Opportunities

Tasks 1 and 2 can be done in parallel (independent).
Tasks 7 and 8 can be done in parallel with task 6.
Task 9 can be done anytime after task 3.

## Rollback Plan

If issues arise in production:
1. Set `MAX_CONCURRENT_ATTACHMENTS=0` to disable attachment feature
2. Update VideoAttachmentService to skip attachment when limit=0
3. Bot falls back to URL-only behavior (previous working state)
