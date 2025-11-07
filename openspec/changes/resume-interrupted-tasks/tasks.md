# Implementation Tasks: resume-interrupted-tasks

## Task Order
Tasks are ordered to deliver incremental functionality with testing at each stage.

---

## 1. Add database query methods for incomplete requests
**Deliverable:** Methods to fetch pending and generating requests

- Add `getIncompleteRequests()` to `RequestTrackingService`:
  ```typescript
  async getIncompleteRequests(maxAgeHours: number = 24): Promise<VideoRequestRow[]>
  ```
- Query WHERE status IN ('pending', 'generating')
- AND created_at >= NOW() - INTERVAL maxAgeHours
- ORDER BY created_at ASC
- Add unit test mocking database response

**Validation:**
- Method compiles and returns correct TypeScript types
- Test verifies SQL query structure

**Dependency:** None

---

## 2. Create TaskResumeService scaffold
**Deliverable:** New service for managing task resumption

- Create `src/discord/task-resume.service.ts`
- Inject dependencies: `RequestTrackingService`, `VeoService`, `StorageService`, `VideoAttachmentService`
- Add placeholder methods:
  - `resumeIncompleteTasks(): Promise<void>`
  - `resumePendingRequest(request: VideoRequestRow): Promise<void>`
  - `resumeGeneratingRequest(request: VideoRequestRow): Promise<void>`
- Register service in `DiscordModule`

**Validation:**
- Service compiles without errors
- Can be injected into DiscordService

**Dependency:** Task 1

---

## 3. Implement resumePendingRequest logic
**Deliverable:** Restart generation for pending requests

- Implement `resumePendingRequest()`:
  - Extract generation parameters from VideoRequestRow
  - Call `VeoService.startGeneration()` with original params
  - Update database status to `generating` with new operation_name
  - Handle errors (mark as failed, don't throw)
- Add logging for start and completion
- Store generated operation_name in database

**Validation:**
- Method restarts generation successfully
- Database updates correctly
- Errors don't crash process

**Dependency:** Task 2

---

## 4. Implement resumeGeneratingRequest logic
**Deliverable:** Resume polling for in-progress operations

- Implement `resumeGeneratingRequest()`:
  - Use stored `operation_name` to poll Vertex AI
  - Call `VeoService.pollOperation()` to check status
  - If complete: process results, update database, return success
  - If still running: continue polling until done
  - If not found (404): mark as timeout
  - If failed: update database with error
- Add error handling for expired operations

**Validation:**
- Successfully resumes polling for existing operations
- Handles 404/not found gracefully
- Marks completed operations correctly

**Dependency:** Task 2

---

## 5. Add Discord channel messaging without interaction
**Deliverable:** Send completion messages to channels when interaction unavailable

- Create helper method `sendChannelMessage()` in TaskResumeService:
  - Accept channel_id, user_id, embed, optional attachment
  - Fetch channel using Discord client
  - Send message mentioning user (<@user_id>)
  - Include "Resumed after bot restart" footer
  - Handle permission errors gracefully
- Return success/failure result

**Validation:**
- Successfully sends messages to accessible channels
- Gracefully handles missing permissions
- User mentions work correctly

**Dependency:** Task 2

---

## 6. Integrate completion notification in resume methods
**Deliverable:** Send Discord messages when resumed tasks complete

- Update `resumePendingRequest()`:
  - After generation completes, call `sendChannelMessage()`
  - Attach video if size ≤25MB using VideoAttachmentService
  - Include completion embed with video details
- Update `resumeGeneratingRequest()`:
  - After polling completes, call `sendChannelMessage()`
  - Same attachment and embed logic
- Handle both success and failure cases

**Validation:**
- Users receive notifications in original channel
- Video attachments work correctly
- Failure messages include retry suggestions

**Dependency:** Tasks 3, 4, 5

---

## 7. Implement main resumeIncompleteTasks orchestration
**Deliverable:** Coordinate resumption of all incomplete requests

- Implement `resumeIncompleteTasks()`:
  - Call `RequestTrackingService.getIncompleteRequests()`
  - Log counts of pending vs generating
  - Process with concurrency limit of 3 using Promise.allSettled
  - For each request:
    - If status === 'pending': call `resumePendingRequest()`
    - If status === 'generating': call `resumeGeneratingRequest()`
  - Log individual results (success/failure)
  - Log summary statistics at end
- Add 10-minute timeout per request

**Validation:**
- Processes multiple requests concurrently
- Doesn't crash on individual failures
- Logs comprehensive progress

**Dependency:** Tasks 3, 4, 6

---

## 8. Hook resume process into bot startup
**Deliverable:** Automatically run resume on Discord client ready

- Update `DiscordService.onModuleInit()`:
  - Inject `TaskResumeService`
  - After client login, listen for `ClientReady` event
  - In ready handler, call `taskResumeService.resumeIncompleteTasks()`
  - Run asynchronously (don't await, don't block)
  - Log when resume process starts and finishes
- Ensure resume runs only once per startup

**Validation:**
- Bot resumes tasks on startup
- Bot still becomes ready quickly (<5s)
- Resume runs in background

**Dependency:** Task 7

---

## 9. Add age-based expiration logic
**Deliverable:** Mark very old requests as expired instead of resuming

- Update `resumeIncompleteTasks()`:
  - Before processing, check request age
  - If `pending` and >24 hours old:
    - Mark as `timeout` in database
    - Set error_message "Request expired (>24 hours old)"
    - Do not attempt generation
    - Log expiration event
  - If `generating`: attempt resume regardless of age (operation may still exist)

**Validation:**
- Old pending requests marked as timeout
- Generating requests checked regardless of age

**Dependency:** Task 7

---

## 10. Add comprehensive logging and metrics
**Deliverable:** Structured logs for observability

- Add log events:
  - Resume process start (with counts)
  - Each request resume attempt (with context)
  - Each request completion (with result)
  - Resume process completion (with summary)
- Include fields:
  - request_id, user_id, guild_id, channel_id
  - age_minutes, status, operation_name
  - resume_result (success/failed/timeout)
  - error_message if applicable
- Track metrics:
  - total_resumed, successful_completions, failures, timeouts
  - total_duration_ms

**Validation:**
- Logs appear with correct structure
- Easy to trace individual request lifecycle
- Summary provides actionable metrics

**Dependency:** Task 7

---

## 11. Add unit tests for TaskResumeService
**Deliverable:** Test coverage for resume logic

- Create `src/discord/task-resume.service.spec.ts`
- Mock dependencies (RequestTrackingService, VeoService, etc.)
- Test cases:
  - ✓ Resume pending request successfully
  - ✓ Resume generating request (operation complete)
  - ✓ Resume generating request (operation still running)
  - ✓ Resume generating request (operation not found)
  - ✓ Handle channel permission errors
  - ✓ Mark old pending requests as expired
  - ✓ Process multiple requests concurrently
  - ✓ Handle database errors gracefully

**Validation:**
- `npm test -- task-resume.service.spec.ts` passes
- Code coverage >80%

**Dependency:** Tasks 3, 4, 7

---

## 12. Integration testing with real database
**Deliverable:** Verified end-to-end resume flow

- Create test script `src/scripts/test-resume.ts`:
  - Insert test requests into database (pending and generating)
  - Trigger bot startup
  - Verify requests are resumed and completed
  - Check database status updates
  - Verify Discord messages sent
- Document test procedure in script comments

**Validation:**
- Script successfully resumes test requests
- Database updates correctly
- Discord messages appear in test channel

**Dependency:** Tasks 8, 9, 10

---

## Parallel Work Opportunities

- Tasks 1 and 2 can be done in parallel
- Tasks 3 and 4 can be done in parallel after task 2
- Task 5 can be done in parallel with tasks 3-4
- Tasks 10 and 11 can be done in parallel with task 9

## Rollback Plan

If issues arise in production:
1. Set environment variable `DISABLE_TASK_RESUME=true`
2. Update TaskResumeService to check flag and skip resume if true
3. Bot operates normally but doesn't resume old tasks
4. Fix issues offline, then re-enable
