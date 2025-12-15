import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  AttachmentBuilder,
} from 'discord.js';
import { logger } from '../../common/logger';
import { validatePromptContent } from '../../common/dto';
import { StorageService } from '../../storage/storage.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { RequestTrackingService } from '../../database/request-tracking.service';
import { RequestType } from '../../database/database.types';
import { QwenImageService } from '../../qwen-image/qwen-image.service';

export class QwenImageCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('qwen-image')
    .setDescription('Generate an image using Qwen-Image (DashScope)')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Text description of the image to generate (min 5 chars)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('ratio')
        .setDescription('Aspect ratio')
        .addChoices(
          { name: '1:1 (square)', value: '1:1' },
          { name: '16:9 (landscape)', value: '16:9' },
          { name: '9:16 (portrait)', value: '9:16' },
          { name: '4:3 (standard)', value: '4:3' },
          { name: '3:4 (portrait standard)', value: '3:4' },
        ),
    );

  constructor(
    private readonly qwenImageService: QwenImageService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
    private readonly requestTrackingService: RequestTrackingService,
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId || 'dm';
    const channelId = interaction.channelId;

    // Channel whitelist check (same as Banana/Veo)
    const allowedChannels =
      process.env.ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) || [];

    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      await interaction.reply({
        content: '⛔ This command can only be used in authorized channels.',
        ephemeral: true,
      });
      logger.warn({ userId, channelId, guildId }, 'Unauthorized channel');
      return;
    }

    await interaction.deferReply();

    try {
      const prompt = interaction.options.getString('prompt', true);
      const ratio =
        (interaction.options.getString('ratio') ?? '1:1') as
          | '1:1'
          | '16:9'
          | '9:16'
          | '4:3'
          | '3:4';

      if (prompt.trim().length < 5) {
        await interaction.editReply('❌ Prompt must be at least 5 characters.');
        return;
      }

      // Content safety validation (reuse your existing validator)
      const contentCheck = validatePromptContent(prompt);
      if (!contentCheck.valid) {
        await interaction.editReply(`❌ ${contentCheck.reason}`);
        return;
      }

      // Rate limit (recommended: add RequestType.QWEN_IMAGE)
      const rateLimitResult = await this.rateLimitService.consume(
        userId,
        // If you haven't added QWEN_IMAGE yet, temporarily change to RequestType.BANANA
        RequestType.QWEN_IMAGE as any,
      );

      if (!rateLimitResult.allowed) {
        const hours = Math.floor(rateLimitResult.waitSeconds! / 3600);
        const minutes = Math.floor((rateLimitResult.waitSeconds! % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        await interaction.editReply(
          `⏱️ You've reached your daily limit. Please try again in ${timeStr}.`,
        );
        return;
      }

      // Create request in database
      const requestId = await this.requestTrackingService.createRequest({
        user_id: userId,
        guild_id: guildId,
        channel_id: channelId,
        prompt,
        request_type: RequestType.QWEN_IMAGE as any,
        aspect_ratio: ratio,
      });

      logger.info(
        { userId, guildId, channelId, requestId, ratio },
        'Processing /qwen-image command',
      );

      // Build output URI (same as Banana)
      const prefix = this.storageService.buildOutputPrefix(
        guildId,
        channelId,
        userId,
        requestId,
      );
      const outputUri = this.storageService.buildOutputUri(prefix);

      // Start generation (sync flow: downloads from DashScope and uploads to GCS)
      const operationName = await this.qwenImageService.startGeneration(
        {
          prompt,
          aspectRatio: ratio,
          sampleCount: 1,
        },
        outputUri,
      );

      // Progress UI (same as Banana)
      const progressEmbed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setDescription(`**${prompt}**`)
        .setFooter({ text: 'Generating image...' })
        .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed] });

      await this.qwenImageService.pollOperation(operationName, prefix, async (p) => {
        const percentage = Math.round(p * 100);
        const progressBar = this.createProgressBar(p);
        progressEmbed.setFooter({ text: `${progressBar} ${percentage}% complete` }).setTimestamp();
        try {
          await interaction.editReply({ embeds: [progressEmbed] });
        } catch (e) {
          logger.warn({ e }, 'Failed to update progress message');
        }
      });

      // List generated image files
      const files = await this.storageService.listImageFiles(prefix);

      if (files.length === 0) {
        await interaction.editReply(
          `❌ Generation completed but no image files were found. Operation: \`${operationName}\``,
        );
        return;
      }

      // Make public and build URLs
      const publicUrls: string[] = [];
      for (const f of files) {
        await this.storageService.makePublic(f);
        publicUrls.push(this.storageService.publicUrl(f));
      }

      // Completion embed
      const completionEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`**${prompt}**`)
        .addFields(
          { name: 'Aspect Ratio', value: ratio, inline: true },
          { name: 'Images', value: `${files.length}`, inline: true },
        )
        .setFooter({ text: `Fast mode • ${rateLimitResult.remaining} remaining today` })
        .setTimestamp();

      // Attach image if small enough, else fallback to URL (same as Banana)
      try {
        const buf = await this.storageService.downloadToBuffer(files[0]);
        if (buf.length < 8 * 1024 * 1024) {
          const attachment = new AttachmentBuilder(buf, { name: 'image.png' });
          completionEmbed.setImage('attachment://image.png');
          await interaction.editReply({ embeds: [completionEmbed], files: [attachment] });
        } else {
          await interaction.editReply({ content: publicUrls.join('\n'), embeds: [completionEmbed] });
        }
      } catch (e) {
        await interaction.editReply({ content: publicUrls.join('\n'), embeds: [completionEmbed] });
      }

      logger.info(
        { userId, requestId, imageCount: publicUrls.length },
        'Qwen-Image generation completed',
      );
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      if (errorMessage.length > 200) errorMessage = errorMessage.substring(0, 200) + '...';

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : error,
          userId,
          guildId,
          channelId,
        },
        'Error executing /qwen-image command',
      );

      if (interaction.deferred) {
        await interaction.editReply(
          `❌ Failed to generate image: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`,
        );
      } else {
        await interaction.reply({ content: `❌ Failed to generate image: ${errorMessage}`, ephemeral: true });
      }
    }
  }

  private createProgressBar(progress: number): string {
    const blocks = 10;
    const filled = Math.round(progress * blocks);
    const empty = blocks - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  }
}