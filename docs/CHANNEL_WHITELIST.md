# Channel Whitelist Configuration

This guide explains how to restrict the `/veo` bot command to specific Discord channels.

## Overview

By default, the bot can be used in any channel where it has permissions. You can restrict it to specific channels (e.g., company channels and test channels) using the `ALLOWED_CHANNEL_IDS` environment variable.

## How to Get Channel IDs

### Method 1: Enable Developer Mode (Recommended)

1. **Enable Developer Mode in Discord:**
   - Open Discord
   - Go to **User Settings** (gear icon near your username)
   - Navigate to **App Settings** → **Advanced**
   - Toggle **Developer Mode** ON

2. **Copy Channel ID:**
   - Right-click on the channel name in the left sidebar
   - Click **Copy Channel ID**
   - Paste it somewhere safe (e.g., notepad)

### Method 2: From URL (Desktop/Web Only)

1. Open Discord in a web browser or desktop app
2. Navigate to the channel
3. Look at the URL bar: `https://discord.com/channels/SERVER_ID/CHANNEL_ID`
4. The last number in the URL is the channel ID

### Example Channel IDs

Channel IDs are 17-19 digit numbers that look like:
```
1234567890123456789
9876543210987654321
```

## Configuration

### Step 1: Identify Your Channels

Create a list of channels where you want the bot to work:

| Channel Name | Channel ID |
|--------------|------------|
| #video-generation | 1234567890123456789 |
| #bot-testing | 9876543210987654321 |
| #company-internal | 1111222233334444555 |

### Step 2: Update `.env` File

Add the channel IDs to your `.env` file, separated by commas:

```env
ALLOWED_CHANNEL_IDS=1234567890123456789,9876543210987654321,1111222233334444555
```

**No spaces between IDs** (spaces are automatically trimmed, but best practice is to avoid them).

### Step 3: Restart the Bot

```bash
# Development
npm run start:dev

# Production
npm run start:prod
```

## Testing

### Test Allowed Channel

1. Go to a whitelisted channel (e.g., `#video-generation`)
2. Run: `/veo prompt:"test video"`
3. Bot should respond normally

### Test Blocked Channel

1. Go to a non-whitelisted channel (e.g., `#general`)
2. Run: `/veo prompt:"test video"`
3. Bot should respond with: `⛔ This command can only be used in authorized channels.`

## Disabling Whitelist

To allow the bot to work in **all channels**, simply:

1. Remove or comment out `ALLOWED_CHANNEL_IDS` in `.env`:
   ```env
   # ALLOWED_CHANNEL_IDS=
   ```

2. Or set it to empty:
   ```env
   ALLOWED_CHANNEL_IDS=
   ```

3. Restart the bot

## Approach 2: Discord Permission Overrides (Alternative)

Instead of bot-level restrictions, you can use Discord's built-in permission system:

### Per-Channel Permissions

1. **Navigate to Channel Settings:**
   - Right-click the channel
   - Click **Edit Channel**

2. **Go to Permissions:**
   - Select **Permissions** tab

3. **Add Bot Role:**
   - Click **+ Add members or roles**
   - Select your bot's role

4. **Configure Permissions:**
   - **Allow** → Use Application Commands ✅
   - Save changes

5. **Block in Other Channels:**
   - Repeat for other channels
   - **Deny** → Use Application Commands ❌

### Category-Level Permissions

For multiple channels:

1. Right-click a **category** (channel group)
2. **Edit Category** → **Permissions**
3. Add bot role with:
   - **Deny** → Use Application Commands ❌
4. Override in specific channels where bot should work

## Comparison: Bot Code vs Discord Permissions

| Feature | Bot Code (ALLOWED_CHANNEL_IDS) | Discord Permissions |
|---------|-------------------------------|---------------------|
| **Setup Complexity** | Simple (env var) | Moderate (per-channel config) |
| **Centralized Control** | Yes (code/env) | No (Discord UI) |
| **Error Message** | Custom message | Generic "Interaction Failed" |
| **Flexibility** | Easy to update | Requires Discord admin |
| **Deployment** | Requires bot restart | Instant |
| **Auditability** | Logged in bot | Discord audit log |

**Recommendation:** Use bot-level restrictions (`ALLOWED_CHANNEL_IDS`) for:
- Programmatic control
- Better error messages
- Centralized configuration
- Audit logging

Use Discord permissions for:
- Non-technical administrators
- No code changes needed
- Instant updates

## Example Configuration

### Company Setup

```env
# Production channels
ALLOWED_CHANNEL_IDS=1111111111111111111,2222222222222222222

# Where:
# 1111111111111111111 = #video-marketing (company channel)
# 2222222222222222222 = #bot-testing (test channel)
```

### Development Setup

```env
# Allow all channels during development
ALLOWED_CHANNEL_IDS=
```

### Staging Setup

```env
# Only test channel in staging
ALLOWED_CHANNEL_IDS=3333333333333333333
```

## Troubleshooting

### Bot Still Works in Non-Whitelisted Channels

**Possible Causes:**
- `.env` not loaded
- Bot not restarted after config change
- Whitelist is empty (all channels allowed)

**Solution:**
1. Verify `.env` file has `ALLOWED_CHANNEL_IDS` set
2. Restart the bot completely
3. Check console logs for "Command attempted in unauthorized channel"

### Bot Doesn't Work in Whitelisted Channels

**Possible Causes:**
- Wrong channel ID
- Typo in channel ID
- Extra spaces in `.env`

**Solution:**
1. Re-copy channel ID from Discord (Developer Mode)
2. Check for typos: `1234567890123456789` (17-19 digits)
3. Remove spaces: `ID1,ID2,ID3` (no spaces)
4. Restart bot and test

### Can't Copy Channel ID

**Solution:**
1. Ensure Developer Mode is enabled
2. Try Method 2 (URL method)
3. Ask server admin for channel ID

## Security Considerations

### ✅ DO:
- Restrict to company/internal channels in production
- Include a test channel for safe experimentation
- Document which channels are whitelisted
- Monitor logs for unauthorized attempts

### ❌ DON'T:
- Hardcode channel IDs in source code
- Share channel IDs publicly
- Use production channel IDs in development
- Forget to update whitelist when adding new channels

## Advanced: Dynamic Whitelist

For advanced use cases, you can modify the code to:

1. **Load from database** instead of env var
2. **Admin commands** to add/remove channels dynamically
3. **Guild-specific whitelists** (different per server)

Example code modification (not implemented by default):

```typescript
// In veo.command.ts
const allowedChannels = await this.configService.getAllowedChannels(guildId);
```

## Quick Reference

### Get Channel ID
1. Enable Developer Mode
2. Right-click channel → Copy Channel ID

### Add to Whitelist
```env
ALLOWED_CHANNEL_IDS=CHANNEL_ID_1,CHANNEL_ID_2
```

### Test
- ✅ Allowed: Bot responds normally
- ❌ Blocked: "⛔ This command can only be used in authorized channels."

### Disable Whitelist
```env
ALLOWED_CHANNEL_IDS=
```

## Related Documentation

- Main README: `/README.md`
- Discord Bot Setup: [Notion Guide](https://www.notion.so/29400eff461d81059e5bdf79558fd396)
- Design Document: [Notion Link](https://www.notion.so/29400eff461d81419e5bf13c6a751a90)
