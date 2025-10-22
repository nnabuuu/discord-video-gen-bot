# Discord Video Generation Bot

A production-ready NestJS Discord bot that generates short videos using **Google Cloud Vertex AI Veo 3.1**, stores them in Google Cloud Storage (GCS), and makes them publicly accessible.

## Features

- 🎬 Generate 4-8 second videos using Vertex AI Veo 3.1
- 🎨 Customizable aspect ratio (16:9 or 9:16), resolution (720p/1080p), and audio
- 🔒 Per-user rate limiting (5 videos per 24 hours)
- ☁️ Automatic GCS upload and public URL generation
- 📊 Comprehensive logging with Pino
- 🚀 Built with NestJS and TypeScript

## Prerequisites

- Node.js 20+
- Discord Bot Application
- Google Cloud Project with:
  - Vertex AI API enabled
  - Cloud Storage bucket created
  - Service account with appropriate permissions

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Navigate to **Bot** section and create a bot
4. Copy the bot token
5. Enable required intents (Guild)
6. Navigate to **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
7. Use the generated URL to invite the bot to your server

## Google Cloud Setup

### 1. Enable Required APIs

```bash
gcloud services enable aiplatform.googleapis.com
gcloud services enable storage.googleapis.com
```

### 2. Create Storage Bucket

```bash
gcloud storage buckets create gs://discord-video-gen-bot-test \
  --location=us-central1 \
  --uniform-bucket-level-access=false
```

**Important**: Use `--uniform-bucket-level-access=false` to enable Fine-grained ACL, which allows per-object public access (recommended).

### 3. Grant Vertex AI Service Account Access

Find your project number:

```bash
gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)"
```

Grant the Vertex AI service account storage permissions:

```bash
gcloud storage buckets add-iam-policy-binding gs://discord-video-gen-bot-test \
  --member="serviceAccount:service-PROJECT_NUMBER@vertex-ai.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

### 4. Public Access Configuration

You have two options for making videos publicly accessible:

#### Option A: Per-Object Public Access (Recommended)

This is the most secure approach with the smallest blast radius.

1. **Bucket is already configured** with Fine-grained ACL (from step 2)
2. Set `PUBLIC_ACCESS_MODE=object` in `.env`
3. The bot will automatically call `file.makePublic()` on each generated video

**Advantages:**
- Only generated videos are public
- Minimal security risk
- No manual bucket-level policy changes

#### Option B: Bucket-Wide Public Access (Simpler, Less Secure)

1. Grant public read access to the entire bucket:

```bash
gcloud storage buckets add-iam-policy-binding gs://discord-video-gen-bot-test \
  --member="allUsers" \
  --role="roles/storage.objectViewer"
```

2. Set `PUBLIC_ACCESS_MODE=bucket` in `.env`

**Note:** This makes ALL objects in the bucket publicly readable. Only use this if you understand the security implications.

### 5. Authentication

#### For Local Development

Create a service account and download the key:

```bash
gcloud iam service-accounts create discord-video-bot \
  --display-name="Discord Video Bot"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:discord-video-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:discord-video-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create ./service-account-key.json \
  --iam-account=discord-video-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Set `SERVICE_ACCOUNT_JSON=./service-account-key.json` in your `.env` file.

#### For Production (Cloud Run, GKE, etc.)

Use [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials):

1. Attach the service account to your compute resource
2. Do NOT set `SERVICE_ACCOUNT_JSON` in production
3. The bot will automatically use ADC

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Discord
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_application_id_here

# Google Cloud
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1
VEO_MODEL_ID=veo-3.1-generate-preview
OUTPUT_BUCKET=discord-video-gen-bot-test

# Public Access Mode (object or bucket)
PUBLIC_ACCESS_MODE=object

# Optional: Service Account (local dev only)
# SERVICE_ACCOUNT_JSON=./service-account-key.json

# Optional: Redis for distributed rate limiting
# REDIS_URL=redis://localhost:6379

# Optional: Channel Whitelist (comma-separated channel IDs)
# Leave empty to allow all channels
# ALLOWED_CHANNEL_IDS=1234567890123456789,9876543210987654321
```

## Usage

### Register Slash Commands

Before running the bot, register the `/veo` command with Discord:

```bash
npm run register:commands
```

### Start the Bot

Development mode (with auto-reload):

```bash
npm run start:dev
```

Production mode:

```bash
npm run build
npm run start:prod
```

### Using the /veo Command

In Discord, use the `/veo` command with the following options:

```
/veo prompt:"A serene ocean sunset with gentle waves"
     length:8
     ratio:16:9
     hd:true
     audio:true
```

**Parameters:**
- `prompt` (required): Text description of the video (5-600 characters)
- `length` (optional): Duration in seconds - 4, 6, or 8 (default: 8)
- `ratio` (optional): Aspect ratio - "16:9" or "9:16" (default: "16:9")
- `hd` (optional): Generate in HD (1080p) vs SD (720p) (default: true)
- `audio` (optional): Generate audio for the video (default: true)

**Rate Limits:**
- 5 videos per user per 24-hour rolling window
- Limit resets as old requests fall outside the 24-hour window

**Channel Restrictions:**
- Optionally restrict bot usage to specific channels via `ALLOWED_CHANNEL_IDS`
- If not set, bot works in all channels where it has permissions

## Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── common/
│   ├── dto.ts             # Zod validation schemas
│   ├── types.ts           # TypeScript interfaces
│   └── logger.ts          # Pino logger configuration
├── auth/
│   ├── auth.module.ts
│   └── auth.service.ts    # Google Cloud authentication
├── storage/
│   ├── storage.module.ts
│   └── storage.service.ts # GCS operations
├── rate-limit/
│   ├── rate-limit.module.ts
│   └── rate-limit.service.ts # Redis/in-memory rate limiting
├── veo/
│   ├── veo.module.ts
│   └── veo.service.ts     # Vertex AI Veo client
├── discord/
│   ├── discord.module.ts
│   ├── discord.service.ts # Discord.js client
│   └── commands/
│       └── veo.command.ts # /veo command handler
└── scripts/
    └── register-commands.ts # Slash command registration
```

## Rate Limiting

The bot enforces a quota of **5 videos per user per 24 hours** using a rolling window.

### Redis (Recommended for Production)

Set `REDIS_URL` to use Redis for distributed rate limiting:

```env
REDIS_URL=redis://localhost:6379
```

### In-Memory Fallback

If `REDIS_URL` is not set, the bot uses an in-memory store. **Note:** This only works for single-instance deployments and resets on restart.

## Video Generation Flow

1. User invokes `/veo` command
2. Bot validates input and checks rate limit
3. Sends "generating..." message to Discord
4. Calls Vertex AI Veo 3.1 `predictLongRunning` endpoint
5. Polls the operation until completion (max 5 minutes)
6. Lists generated .mp4 files from GCS prefix
7. Makes each file publicly accessible (if `PUBLIC_ACCESS_MODE=object`)
8. Returns public HTTPS URLs to user

## Troubleshooting

### "Failed to get access token"

- **Local Dev**: Ensure `SERVICE_ACCOUNT_JSON` points to a valid key file
- **Production**: Verify the service account is attached to your compute resource and has the correct roles

### "Operation timed out after 5 minutes"

- Veo generation can take several minutes. If it times out consistently, check the Vertex AI logs in Google Cloud Console
- Verify your project has Vertex AI quota available

### "Failed to make object public"

- **Object mode**: Ensure the bucket has Fine-grained ACL enabled (`uniform-bucket-level-access=false`)
- **Bucket mode**: Verify `allUsers:objectViewer` policy is set on the bucket

### "No video files were found"

- Check GCS bucket for the expected prefix: `discord/{guildId}/{channelId}/{userId}/{requestId}/`
- Verify the Vertex AI service account has `roles/storage.objectAdmin` on the bucket
- Check Vertex AI operation logs for errors

### Rate limit not working correctly

- If using Redis, ensure `REDIS_URL` is set correctly and Redis is running
- For in-memory mode, limits reset on bot restart

## Development

### Linting

```bash
npm run lint
```

### Testing

```bash
npm test
npm run test:watch
npm run test:cov
```

## Deployment

### Cloud Run (Recommended)

1. Build container:

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/discord-video-bot
```

2. Deploy to Cloud Run:

```bash
gcloud run deploy discord-video-bot \
  --image gcr.io/YOUR_PROJECT_ID/discord-video-bot \
  --platform managed \
  --region us-central1 \
  --service-account discord-video-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars="DISCORD_BOT_TOKEN=...,DISCORD_APP_ID=...,GCP_PROJECT_ID=...,OUTPUT_BUCKET=...,PUBLIC_ACCESS_MODE=object" \
  --no-allow-unauthenticated \
  --memory 512Mi \
  --cpu 1
```

3. The service will start the Discord bot and keep it running

## Security Considerations

1. **Never commit** `.env` or service account JSON files to version control
2. Use **per-object public access** (`PUBLIC_ACCESS_MODE=object`) to minimize exposure
3. Implement **content moderation** in `validatePromptContent()` for production use
4. Consider adding **CAPTCHA** or additional verification for new users
5. Monitor **GCS bucket** for unexpected public files
6. Rotate service account keys regularly

## License

MIT

## Support

For issues and questions:
- Check the troubleshooting section above
- Review Google Cloud logs (Vertex AI and Cloud Storage)
- Consult [Discord.js documentation](https://discord.js.org/)
- Consult [Vertex AI documentation](https://cloud.google.com/vertex-ai/docs)
