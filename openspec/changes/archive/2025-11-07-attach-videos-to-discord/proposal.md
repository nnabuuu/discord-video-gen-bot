# Proposal: attach-videos-to-discord

## Status
**DRAFT** - Awaiting review

## Context
Currently, when the `/veo` command completes video generation, the bot sends GCS public URLs in the Discord message. Users must click the URL to view the video in a browser. Discord supports direct video attachments that display inline previews, providing a better user experience similar to Midjourney's image outputs.

## Problem
- Users cannot preview videos directly in Discord
- Requires extra click to view video in browser
- Less engaging user experience
- GCS URLs don't trigger Discord's media embed system

## Proposed Solution
Download generated videos from GCS and attach them directly to Discord messages when file size permits. This enables Discord's built-in video player to show inline previews.

**Approach:**
1. Implement concurrency limiter (max 5 concurrent download/attach operations) to manage bandwidth
2. After video generation completes, acquire slot from concurrency limiter
3. Download video file(s) from GCS to temporary buffer
4. Check file size against Discord's 25MB attachment limit
5. If size ≤25MB: attach video file using `AttachmentBuilder`
6. If size >25MB: fallback to current URL-based approach with warning message
7. Clean up temporary buffers and release concurrency slot after message is sent

**Benefits:**
- Inline video preview in Discord (no extra clicks)
- Better user experience matching modern bot UX patterns
- Videos still accessible via URL if attachment fails

**Trade-offs:**
- Additional GCS egress bandwidth (download video to bot)
- Temporary memory usage during message send
- Potential edge cases with very large files (handled by size check + fallback)

## Scope
**In Scope:**
- Concurrency limiter for download/attach operations (max 5 concurrent)
- Download video files from GCS in veo.command.ts
- Size validation against Discord limits
- Direct file attachment using Discord.js AttachmentBuilder
- Graceful fallback to URL for oversized files
- Error handling for download failures and concurrency queue

**Out of Scope:**
- Video transcoding or compression
- Persistent local caching
- Multi-attachment optimization beyond simple iteration
- Custom thumbnail generation

## Dependencies
- Existing `StorageService` methods for GCS access
- Discord.js `AttachmentBuilder` API
- No new external libraries required

## Risks
1. **Memory usage spike** - Mitigated by size check, buffer cleanup, and concurrency limit
2. **Bandwidth saturation** - Mitigated by max 5 concurrent downloads
3. **GCS download failures** - Mitigated by fallback to URL approach
4. **Discord API rate limits** - Unlikely for single-file attachments per command
5. **Queue buildup during high traffic** - Mitigated by fast video sizes (<10MB typical)

## Alternatives Considered
1. **Keep URL-only approach** - Rejected: poor UX
2. **Always attach, no size check** - Rejected: Discord rejects >25MB
3. **Use Discord CDN proxy** - Rejected: requires Discord to fetch from GCS (still no inline preview)

## Success Criteria
- Videos ≤25MB display inline in Discord messages
- Videos >25MB gracefully fall back to URL with user notification
- No increase in error rate for `/veo` command
- Download latency <5 seconds for typical 8-second videos
