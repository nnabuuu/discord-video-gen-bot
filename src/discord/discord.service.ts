import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../common/logger';
import { VeoCommand } from './commands/veo.command';
import { VeoService } from '../veo/veo.service';
import { StorageService } from '../storage/storage.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private veoCommand: VeoCommand;

  constructor(
    private readonly veoService: VeoService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.veoCommand = new VeoCommand(veoService, storageService, rateLimitService);
  }

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN is required');
    }

    this.client.once(Events.ClientReady, (readyClient) => {
      logger.info({ user: readyClient.user.tag }, 'Discord bot is ready');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      await this.handleCommand(interaction);
    });

    this.client.on(Events.Error, (error) => {
      logger.error({ error }, 'Discord client error');
    });

    try {
      await this.client.login(token);
    } catch (error) {
      logger.error({ error }, 'Failed to login to Discord');
      throw error;
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const { commandName } = interaction;

    logger.info(
      {
        commandName,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
      'Received command',
    );

    try {
      if (commandName === 'veo') {
        await this.veoCommand.execute(interaction);
      } else {
        await interaction.reply({
          content: 'Unknown command',
          ephemeral: true,
        });
      }
    } catch (error) {
      logger.error({ error, commandName }, 'Error handling command');

      const errorMsg = 'An error occurred while executing this command.';

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(errorMsg);
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true });
        }
      } catch (replyError) {
        logger.error({ error: replyError }, 'Failed to send error message');
      }
    }
  }
}
