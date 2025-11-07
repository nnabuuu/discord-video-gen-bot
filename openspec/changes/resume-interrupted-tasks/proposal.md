# Proposal: resume-interrupted-tasks

## Status
**DRAFT** - Awaiting review

## Context
Currently, when the Discord bot restarts (due to crash, deployment, or manual restart), any video generation requests that were in progress are abandoned. Users receive no completion notification, and the system doesn't track what happened to these requests.

**Current behavior on restart:**
- Pending requests (not yet started) remain in database with status `pending` but are never processed
- Generating requests (Vertex AI operation running) remain with status `generating` but polling stops
- Database tracks `operation_name` for in-progress requests, but this data is unused after restart

## Problem
- **Poor user experience**: Users don't know if their video will complete or if they need to retry
- **Resource waste**: Vertex AI may complete generation, but bot never checks or notifies user
- **Data inconsistency**: Database shows `generating` but bot isn't actually polling
- **Lost work**: Pending requests that passed rate limiting are never processed

## Proposed Solution
Implement a task resumption system that runs on bot startup to recover and complete interrupted video generation requests.

**Approach:**
1. **On startup**, query database for incomplete requests (`pending` or `generating` status)
2. **Sort by timestamp** (older first) to maintain FIFO order
3. **For each pending request**:
   - Restart video generation from beginning
   - Try to use original Discord interaction (if <15 min old)
   - Otherwise, send new message to the channel
4. **For each generating request**:
   - Resume polling the existing Vertex AI operation using stored `operation_name`
   - Check if generation already completed while bot was down
   - If completed, process results and notify user
   - If still generating, continue polling
   - If operation expired/failed, mark as timeout
5. **Process with priority**: Resumed tasks run before new `/veo` commands

**Benefits:**
- Users always get their video (or clear failure notification)
- No lost work even after bot restarts
- Better reliability for production deployment
- Utilizes existing database tracking infrastructure

**Trade-offs:**
- Startup time increases (proportional to number of interrupted tasks)
- Complexity in handling expired Discord interactions
- Need to store channel_id in database (already done ✓)

## Scope
**In Scope:**
- Query incomplete requests from database on startup
- Resume pending requests (restart generation)
- Resume generating requests (resume polling)
- Send completion messages to Discord channel
- Handle expired Discord interactions (>15 min)
- Prioritize resumed tasks over new requests
- Logging and error handling for resume process

**Out of Scope:**
- Retry failed requests (only resume interrupted ones)
- User notification via DM (channel messages only)
- Manual resume via slash command (automatic only)
- Resume requests older than 24 hours (mark as timeout instead)

## Dependencies
- Existing `RequestTrackingService` for querying incomplete requests
- Existing `VeoService` for polling operations
- Discord.js `Client` for sending messages to channels
- Current database schema (already stores channel_id, operation_name)

## Risks
1. **Startup flood** - Many concurrent resumes could overwhelm Vertex AI
   - **Mitigation**: Process sequentially or with concurrency limit
2. **Stale operations** - Vertex AI operations may have expired
   - **Mitigation**: Handle "operation not found" errors gracefully
3. **Channel access** - Bot may not have permissions in old channels
   - **Mitigation**: Catch permission errors, mark request as failed

## Alternatives Considered
1. **No resumption** - Rejected: poor UX, resource waste
2. **DM users instead of channel messages** - Rejected: requires storing user preferences, more complex
3. **Resume only generating (not pending)** - Rejected: unfair to users whose requests never started

## Success Criteria
- Bot resumes all incomplete requests on startup
- Users receive completion notification (via interaction or new message)
- Resumed tasks process before new requests
- No requests stuck in `pending` or `generating` after startup
- Clear logs showing resume process and outcomes
