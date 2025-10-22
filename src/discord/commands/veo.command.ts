import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { logger } from '../../common/logger';
import { VeoCommandOptionsSchema, validatePromptContent } from '../../common/dto';
import { VeoService } from '../../veo/veo.service';
import { StorageService } from '../../storage/storage.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { randomUUID } from 'crypto';

export class VeoCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('veo')
    .setDescription('Generate a video using Google Cloud Vertex AI Veo 3.1')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Text description of the video to generate (min 5 chars)')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('length')
        .setDescription('Video duration in seconds')
        .addChoices(
          { name: '4 seconds', value: 4 },
          { name: '6 seconds', value: 6 },
          { name: '8 seconds', value: 8 },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('ratio')
        .setDescription('Aspect ratio')
        .addChoices(
          { name: '16:9 (landscape)', value: '16:9' },
          { name: '9:16 (portrait)', value: '9:16' },
        ),
    )
    .addBooleanOption((option) =>
      option.setName('hd').setDescription('Generate in HD (1080p) vs SD (720p)'),
    )
    .addBooleanOption((option) =>
      option.setName('audio').setDescription('Generate audio for the video'),
    );

  constructor(
    private readonly veoService: VeoService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
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

    try {
      // Parse and validate options
      const rawOptions = {
        prompt: interaction.options.getString('prompt', true),
        length: interaction.options.getInteger('length') ?? 8,
        ratio: interaction.options.getString('ratio') ?? '16:9',
        hd: interaction.options.getBoolean('hd') ?? true,
        audio: interaction.options.getBoolean('audio') ?? true,
      };

      const parseResult = VeoCommandOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        await interaction.reply({
          content: `❌ Invalid options: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
          ephemeral: true,
        });
        return;
      }

      const options = parseResult.data;

      // Content safety validation
      const contentCheck = validatePromptContent(options.prompt);
      if (!contentCheck.valid) {
        await interaction.reply({
          content: `❌ ${contentCheck.reason}`,
          ephemeral: true,
        });
        return;
      }

      // Rate limit check
      const rateLimitResult = await this.rateLimitService.consume(userId);
      if (!rateLimitResult.allowed) {
        const hours = Math.floor(rateLimitResult.waitSeconds! / 3600);
        const minutes = Math.floor((rateLimitResult.waitSeconds! % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        await interaction.reply({
          content: `⏱️ You've reached your daily limit of 5 videos. Please try again in ${timeStr}.`,
          ephemeral: true,
        });
        return;
      }

      // Send initial response
      await interaction.deferReply();

      const requestId = randomUUID();
      const resolution = options.hd ? '1080p' : '720p';

      logger.info(
        {
          userId,
          guildId,
          channelId,
          requestId,
          options,
        },
        'Processing /veo command',
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
      const operationName = await this.veoService.startGeneration(
        {
          prompt: options.prompt,
          durationSeconds: options.length as 4 | 6 | 8,
          aspectRatio: options.ratio as '16:9' | '9:16',
          resolution,
          generateAudio: options.audio,
          sampleCount: 1,
        },
        outputUri,
      );

      await interaction.editReply(
        `🎬 Generating your video...\n\`\`\`\n${options.prompt}\n\`\`\`\n_This may take up to 5 minutes._`,
      );

      // Poll for completion
      await this.veoService.pollOperation(operationName);

      // List generated files
      const files = await this.storageService.listFiles(prefix);

      if (files.length === 0) {
        await interaction.editReply(
          `❌ Generation completed but no video files were found. Operation: \`${operationName}\``,
        );
        return;
      }

      // Make files public and build URLs
      const publicUrls: string[] = [];
      for (const fileName of files) {
        await this.storageService.makePublic(fileName);
        publicUrls.push(this.storageService.publicUrl(fileName));
      }

      // Build response embed
      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Video Generated Successfully')
        .setDescription(`**Prompt:** ${options.prompt}`)
        .addFields(
          { name: 'Duration', value: `${options.length}s`, inline: true },
          { name: 'Aspect Ratio', value: options.ratio, inline: true },
          { name: 'Resolution', value: resolution, inline: true },
          { name: 'Audio', value: options.audio ? 'Yes' : 'No', inline: true },
          {
            name: 'Remaining Quota',
            value: `${rateLimitResult.remaining}/5 videos`,
            inline: true,
          },
        )
        .setTimestamp();

      const videoLinks = publicUrls.map((url, idx) => `[Video ${idx + 1}](${url})`).join(' • ');

      await interaction.editReply({
        content: `${videoLinks}`,
        embeds: [embed],
      });

      logger.info(
        {
          userId,
          requestId,
          videoCount: publicUrls.length,
          remaining: rateLimitResult.remaining,
        },
        'Video generation completed',
      );
    } catch (error) {
      logger.error({ error, userId, guildId, channelId }, 'Error executing /veo command');

      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';

      if (interaction.deferred) {
        await interaction.editReply(
          `❌ Failed to generate video: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`,
        );
      } else {
        await interaction.reply({
          content: `❌ Failed to generate video: ${errorMessage}`,
          ephemeral: true,
        });
      }
    }
  }
}
