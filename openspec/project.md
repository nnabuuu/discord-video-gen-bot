# Project Context

## Purpose
Production-ready Discord bot that generates short videos (4-8 seconds) using Google Cloud Vertex AI Veo 3.1 model, stores them in Google Cloud Storage, and makes them publicly accessible via HTTPS URLs.

**Key Features**:
- `/veo` slash command with customizable parameters (prompt, length, aspect ratio, resolution, audio)
- Per-user rate limiting (5 videos per 24 hours)
- Channel whitelist support to restrict bot usage
- Comprehensive error handling and structured logging

## Tech Stack
- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.7
- **Framework**: NestJS 10.4
- **Discord**: Discord.js 14.16
- **Cloud Platform**: Google Cloud (Vertex AI, Cloud Storage)
- **Validation**: Zod 3.24
- **Logging**: Pino 9.5
- **Rate Limiting**: Redis (optional) via ioredis 5.4
- **Authentication**: google-auth-library 9.15
- **Testing**: Jest 29.7

## Project Conventions

### Code Style
- **Prettier**: Single quotes, 2-space indentation, 100-character line width, semicolons, trailing commas
- **ESLint**: TypeScript recommended rules + Prettier integration
- **TypeScript**: Strict null checks enabled, noImplicitAny enabled, ES2021 target
- **Naming**: PascalCase for classes/interfaces, camelCase for variables/functions, UPPER_CASE for constants
- **File organization**: `*.service.ts` for services, `*.module.ts` for modules, `*.command.ts` for Discord commands

### Architecture Patterns
- **Modular NestJS Design**: Separate modules for auth, storage, rate-limit, veo, and discord
- **Dependency Injection**: NestJS IoC container for all services
- **Service Layer Pattern**: Business logic in services, controllers/commands handle I/O
- **DTO Validation**: Zod schemas for input validation (`src/common/dto.ts`)
- **Structured Logging**: Pino logger with contextual metadata
- **Exponential Backoff**: For long-running operation polling (1s → 10s max interval, 1.5x multiplier)
- **Graceful Fallbacks**: Redis optional, in-memory rate limiting fallback

### Testing Strategy
- **Framework**: Jest with ts-jest transformer
- **Location**: Tests in `src/` directory alongside source files (`*.spec.ts`)
- **Coverage**: Jest coverage reporting enabled
- **Approach**: Unit tests for services, integration tests for API interactions
- **Commands**: `npm test`, `npm run test:watch`, `npm run test:cov`

### Git Workflow
- **Primary Branch**: `master`
- **Commit Convention**: Conventional Commits format
  - `feat:` for new features
  - `fix:` for bug fixes
  - `chore:` for maintenance tasks
- **Commit Footer**: Include Claude Code attribution:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

## Domain Context

### Video Generation
- **Model**: Google Vertex AI Veo 3.1 (`veo-3.1-generate-preview`)
- **API**: Long-running operation with polling (predictLongRunning endpoint)
- **Duration**: Videos take 2-5 minutes to generate
- **Timeout**: 5-minute max polling duration
- **Output**: MP4 files written to GCS prefix: `discord/{guildId}/{channelId}/{userId}/{requestId}/`

### Discord Integration
- **Command**: `/veo` slash command with options:
  - `prompt` (required): 5-600 characters
  - `length` (optional): 4, 6, or 8 seconds (default: 8)
  - `ratio` (optional): "16:9" or "9:16" (default: "16:9")
  - `hd` (optional): true for 1080p, false for 720p (default: true)
  - `audio` (optional): generate audio (default: true)
- **Intents**: Guild intent required
- **Permissions**: Send Messages, Use Slash Commands

### Rate Limiting
- **Quota**: 5 videos per user per 24-hour rolling window
- **Storage**: Redis (preferred) or in-memory fallback
- **Scope**: Per Discord user ID
- **Reset**: Rolling window, not fixed daily reset

## Important Constraints

### Technical
- **Generation Time**: 2-5 minutes per video (long-running operation)
- **Video Length**: Limited to 4, 6, or 8 seconds only
- **Aspect Ratios**: Only 16:9 (landscape) or 9:16 (portrait) supported
- **Polling Timeout**: Operations timeout after 5 minutes of polling
- **Prompt Length**: 5-600 characters

### Business
- **Rate Limits**: 5 videos per user per 24 hours (prevents abuse)
- **Channel Restrictions**: Optional whitelist via `ALLOWED_CHANNEL_IDS` env var
- **Public Access**: Videos are publicly accessible via HTTPS (security consideration)

### Operational
- **GCS Storage**: Lifecycle policy recommended (auto-delete after 1 day)
- **Authentication**: Service account (local) or Application Default Credentials (production)
- **Public Access Modes**: Per-object (recommended) or bucket-wide (less secure)

## External Dependencies

### Google Cloud Services
- **Vertex AI API**: `aiplatform.googleapis.com`
  - Endpoint: `https://{location}-aiplatform.googleapis.com/v1/`
  - Model: `veo-3.1-generate-preview`
  - Required Role: `roles/aiplatform.user`
- **Cloud Storage API**: `storage.googleapis.com`
  - Bucket with Fine-grained ACL (for per-object public access)
  - Required Role: `roles/storage.objectAdmin`
  - Service Account: `service-{PROJECT_NUMBER}@vertex-ai.iam.gserviceaccount.com` needs bucket access

### Discord API
- **Base URL**: `https://discord.com/api/v10`
- **Required**: Bot token and Application ID
- **Features Used**: Slash commands, message interactions, ephemeral responses

### Redis (Optional)
- **Purpose**: Distributed rate limiting
- **Fallback**: In-memory store (single-instance only)
- **Client**: ioredis library
