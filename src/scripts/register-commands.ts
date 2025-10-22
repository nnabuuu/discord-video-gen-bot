import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { VeoCommand } from '../discord/commands/veo.command';
import { logger } from '../common/logger';

// Load environment variables
config();

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;

if (!token || !appId) {
  logger.error('DISCORD_BOT_TOKEN and DISCORD_APP_ID must be set');
  process.exit(1);
}

const commands = [VeoCommand.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    logger.info(`Started refreshing ${commands.length} application (/) commands.`);

    const data = await rest.put(Routes.applicationCommands(appId), {
      body: commands,
    });

    logger.info({ count: (data as any).length }, 'Successfully registered application commands');
    logger.info('Commands registered:');
    commands.forEach((cmd) => {
      logger.info(`  - /${cmd.name}: ${cmd.description}`);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to register commands');
    process.exit(1);
  }
})();
