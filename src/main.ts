import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logger } from './common/logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false, // Use pino logger instead
  });

  // Validate required environment variables
  const requiredEnvVars = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_APP_ID',
    'GCP_PROJECT_ID',
    'OUTPUT_BUCKET',
  ];

  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error({ missingVars }, 'Missing required environment variables');
    process.exit(1);
  }

  logger.info(
    {
      nodeEnv: process.env.NODE_ENV,
      gcpProject: process.env.GCP_PROJECT_ID,
      gcpLocation: process.env.GCP_LOCATION,
      bucket: process.env.OUTPUT_BUCKET,
      publicAccessMode: process.env.PUBLIC_ACCESS_MODE,
    },
    'Starting Discord Video Gen Bot',
  );

  await app.init();

  // Keep the process running
  logger.info('Bot is running. Press Ctrl+C to exit.');
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Fatal error during bootstrap');
  process.exit(1);
});
