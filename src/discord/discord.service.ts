import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../common/logger';
import { VeoCommand } from './commands/veo.command';
import { BananaCommand } from './commands/banana.command';
import { QwenImageCommand } from './commands/qwen-image.command';
import { WanCommand } from './commands/wan.command';
import { ApiKeyCommand } from './commands/api-key.command';
import { VeoService } from '../veo/veo.service';
import { BananaService } from '../banana/banana.service';
import { QwenImageService } from '../qwen-image/qwen-image.service';
import { WanService } from '../wan/wan.service';
import { StorageService } from '../storage/storage.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { VideoAttachmentService } from './video-attachment.service';
import { RequestTrackingService } from '../database/request-tracking.service';
import { UserApiKeyService } from '../database/user-api-key.service';
import { TaskResumeService } from './task-resume.service';

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private veoCommand: VeoCommand;
  private bananaCommand: BananaCommand;
  private qwenImageCommand: QwenImageCommand;
  private wanCommand: WanCommand;
  private apiKeyCommand: ApiKeyCommand;

  constructor(
    private readonly veoService: VeoService,
    private readonly bananaService: BananaService,
    private readonly qwenImageService: QwenImageService,
    private readonly wanService: WanService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
    private readonly videoAttachmentService: VideoAttachmentService,
    private readonly requestTrackingService: RequestTrackingService,
    private readonly userApiKeyService: UserApiKeyService,
    private readonly taskResumeService: TaskResumeService,
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.veoCommand = new VeoCommand(
      veoService,
      storageService,
      rateLimitService,
      videoAttachmentService,
      requestTrackingService,
    );

    this.bananaCommand = new BananaCommand(
      bananaService,
      storageService,
      rateLimitService,
      requestTrackingService,
      userApiKeyService,
    );

    this.qwenImageCommand = new QwenImageCommand(
      qwenImageService,
      storageService,
      rateLimitService,
      requestTrackingService,
    );

    this.wanCommand = new WanCommand(
      wanService,
      storageService,
      rateLimitService,
      videoAttachmentService,
      requestTrackingService,
    );

    this.apiKeyCommand = new ApiKeyCommand(userApiKeyService);
  }

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN is required');
    }

    // Inject Discord client into TaskResumeService
    this.taskResumeService.setDiscordClient(this.client);

    this.client.once(Events.ClientReady, (readyClient) => {
      logger.info({ user: readyClient.user.tag }, 'Discord bot is ready');

      // Resume incomplete tasks in background (non-blocking)
      this.taskResumeService
        .resumeIncompleteTasks()
        .then(() => {
          logger.info('Task resume process finished');
        })
        .catch((error) => {
          logger.error({ error }, 'Task resume process encountered error');
        });
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
      } else if (commandName === 'banana') {
        await this.bananaCommand.execute(interaction);
      } else if (commandName === 'qwen-image') {
        await this.qwenImageCommand.execute(interaction);
      } else if (commandName === 'wan') {
        await this.wanCommand.execute(interaction);
      } else if (commandName === 'api-key') {
        await this.apiKeyCommand.execute(interaction);
      } else {
        await interaction.reply({
          content: `Unknown command: ${commandName}`,
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
