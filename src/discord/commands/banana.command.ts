import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  AttachmentBuilder,
} from 'discord.js';
import { logger } from '../../common/logger';
import { BananaCommandOptionsSchema, validatePromptContent } from '../../common/dto';
import { BananaService } from '../../banana/banana.service';
import { StorageService } from '../../storage/storage.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { RequestTrackingService } from '../../database/request-tracking.service';
import { RequestType } from '../../database/database.types';
import { randomUUID } from 'crypto';

export class BananaCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('banana')
    .setDescription('Generate an image using Gemini 3 Pro Image Preview (nano-banana)')
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
    private readonly bananaService: BananaService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
    private readonly requestTrackingService: RequestTrackingService,
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId || 'dm';
    const channelId = interaction.channelId;

    // Channel whitelist check
    const allowedChannels = process.env.ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) || [];

    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      await interaction.reply({
        content: '⛔ This command can only be used in authorized channels.',
        ephemeral: true,
      });
      logger.warn(
        { userId, channelId, guildId },
        'Command attempted in unauthorized channel',
      );
      return;
    }

    // Defer immediately to prevent Discord timeout
    await interaction.deferReply();

    try {
      // Parse and validate options
      const rawOptions = {
        prompt: interaction.options.getString('prompt', true),
        ratio: interaction.options.getString('ratio') ?? '1:1',
      };

      const parseResult = BananaCommandOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        await interaction.editReply(
          `❌ Invalid options: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
        return;
      }

      const options = parseResult.data;

      // Content safety validation
      const contentCheck = validatePromptContent(options.prompt);
      if (!contentCheck.valid) {
        await interaction.editReply(`❌ ${contentCheck.reason}`);
        return;
      }

      // Rate limit check
      const rateLimitResult = await this.rateLimitService.consume(userId, RequestType.BANANA);
      if (!rateLimitResult.allowed) {
        const hours = Math.floor(rateLimitResult.waitSeconds! / 3600);
        const minutes = Math.floor((rateLimitResult.waitSeconds! % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        await interaction.editReply(
          `⏱️ You've reached your daily limit of 5 images. Please try again in ${timeStr}.`,
        );
        return;
      }

      // Create request in database
      const requestId = await this.requestTrackingService.createRequest({
        user_id: userId,
        guild_id: guildId,
        channel_id: channelId,
        prompt: options.prompt,
        request_type: RequestType.BANANA,
        aspect_ratio: options.ratio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
      });

      logger.info(
        {
          userId,
          guildId,
          channelId,
          requestId,
          options,
        },
        'Processing /banana command',
      );

      // Build output URI
      const prefix = this.storageService.buildOutputPrefix(
        guildId,
        channelId,
        userId,
        requestId,
      );
      const outputUri = this.storageService.buildOutputUri(prefix);

      // Start generation
      const operationName = await this.bananaService.startGeneration(
        {
          prompt: options.prompt,
          aspectRatio: options.ratio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
          sampleCount: 1,
        },
        outputUri,
      );

      // Progress updates
      const progressEmbed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setDescription(`**${options.prompt}**`)
        .setFooter({ text: 'Generating image...' })
        .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed] });

      // Poll for completion with progress updates
      await this.bananaService.pollOperation(operationName, prefix, async (progress) => {
        const percentage = Math.round(progress * 100);
        const progressBar = this.createProgressBar(progress);

        progressEmbed
          .setFooter({ text: `${progressBar} ${percentage}% complete` })
          .setTimestamp();

        try {
          await interaction.editReply({ embeds: [progressEmbed] });
        } catch (error) {
          logger.warn({ error }, 'Failed to update progress message');
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

      // Make files public and build URLs
      const publicUrls: string[] = [];
      for (const fileName of files) {
        await this.storageService.makePublic(fileName);
        publicUrls.push(this.storageService.publicUrl(fileName));
      }

      // Completion message
      const completionEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`**${options.prompt}**`)
        .addFields(
          { name: 'Aspect Ratio', value: options.ratio, inline: true },
          { name: 'Images', value: `${files.length}`, inline: true },
        )
        .setFooter({
          text: `Fast mode • ${rateLimitResult.remaining - 1} remaining today`,
        })
        .setTimestamp();

      // Try to attach first image if it's small enough
      try {
        const imageBuffer = await this.storageService.downloadToBuffer(files[0]);
        if (imageBuffer.length < 8 * 1024 * 1024) { // 8MB limit for images
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'image.png' });
          completionEmbed.setImage('attachment://image.png');
          await interaction.editReply({
            embeds: [completionEmbed],
            files: [attachment],
          });
        } else {
          // Fallback to URL
          const imageLinks = publicUrls.join('\n');
          await interaction.editReply({
            content: imageLinks,
            embeds: [completionEmbed],
          });
        }
      } catch (error) {
        // Fallback to URL on any error
        const imageLinks = publicUrls.join('\n');
        await interaction.editReply({
          content: imageLinks,
          embeds: [completionEmbed],
        });
      }

      logger.info(
        {
          userId,
          requestId,
          imageCount: publicUrls.length,
          remaining: rateLimitResult.remaining - 1,
        },
        'Image generation completed',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';

      logger.error(
        {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          } : error,
          userId,
          guildId,
          channelId,
        },
        'Error executing /banana command',
      );

      if (interaction.deferred) {
        await interaction.editReply(
          `❌ Failed to generate image: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`,
        );
      } else {
        await interaction.reply({
          content: `❌ Failed to generate image: ${errorMessage}`,
          ephemeral: true,
        });
      }
    }
  }

  private createProgressBar(progress: number): string {
    const blocks = 10;
    const filled = Math.round(progress * blocks);
    const empty = blocks - filled;

    const filledBar = '█'.repeat(filled);
    const emptyBar = '░'.repeat(empty);

    return `${filledBar}${emptyBar}`;
  }
}
