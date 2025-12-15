import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { logger } from '../../common/logger';
import { VeoCommandOptionsSchema, validatePromptContent } from '../../common/dto';
import { StorageService } from '../../storage/storage.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { VideoAttachmentService } from '../video-attachment.service';
import { RequestTrackingService } from '../../database/request-tracking.service';
import { RequestType } from '../../database/database.types';
import { WanService } from '../../wan/wan.service';

export class WanCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('wan')
    .setDescription('Generate a video using Wan (DashScope)')
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
    private readonly wanService: WanService,
    private readonly storageService: StorageService,
    private readonly rateLimitService: RateLimitService,
    private readonly videoAttachmentService: VideoAttachmentService,
    private readonly requestTrackingService: RequestTrackingService,
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId || 'dm';
    const channelId = interaction.channelId;

    const allowedChannels = process.env.ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) || [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      await interaction.reply({ content: '⛔ This command can only be used in authorized channels.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    let dbRequestId: string | null = null;

    try {
      const rawOptions = {
        prompt: interaction.options.getString('prompt', true),
        length: interaction.options.getInteger('length') ?? 4,
        ratio: interaction.options.getString('ratio') ?? '16:9',
        hd: interaction.options.getBoolean('hd') ?? false,
        audio: interaction.options.getBoolean('audio') ?? true,
      };

      const parseResult = VeoCommandOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        await interaction.editReply(`❌ Invalid options: ${parseResult.error.errors.map((e) => e.message).join(', ')}`);
        return;
      }

      const options = parseResult.data;

      const contentCheck = validatePromptContent(options.prompt);
      if (!contentCheck.valid) {
        await interaction.editReply(`❌ ${contentCheck.reason}`);
        return;
      }

      // You should add RequestType.WAN, but you can temporarily reuse VEO to ship fast.
      const rateLimitResult = await this.rateLimitService.consume(userId, (RequestType as any).WAN ?? RequestType.VEO);
      if (!rateLimitResult.allowed) {
        const hours = Math.floor(rateLimitResult.waitSeconds! / 3600);
        const minutes = Math.floor((rateLimitResult.waitSeconds! % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        await interaction.editReply(`⏱️ You've reached your daily limit. Please try again in ${timeStr}.`);
        return;
      }

      const resolution = options.hd ? '1080p' : '720p';

      dbRequestId = await this.requestTrackingService.createRequest({
        user_id: userId,
        guild_id: guildId,
        channel_id: channelId,
        prompt: options.prompt,
        request_type: RequestType.WAN,
        duration_seconds: options.length as 4 | 6 | 8,
        aspect_ratio: options.ratio as '16:9' | '9:16',
        resolution: resolution as '720p' | '1080p',
        generate_audio: options.audio,
      });

      const prefix = this.storageService.buildOutputPrefix(guildId, channelId, userId, dbRequestId);
      const outputUri = this.storageService.buildOutputUri(prefix);

      // Start Wan task
      const taskId = await this.wanService.startGeneration({
        prompt: options.prompt,
        durationSeconds: options.length as 4 | 6 | 8,
        aspectRatio: options.ratio as '16:9' | '9:16',
        resolution: resolution as '720p' | '1080p',
        generateAudio: options.audio,
        sampleCount: 1,
      });

      await this.requestTrackingService.setGenerating(dbRequestId, taskId, prefix);

      const progressEmbed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setDescription(`**${options.prompt}**`)
        .setFooter({ text: 'Waiting to start...' })
        .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed] });

      // Poll task
      const result = await this.wanService.pollOperation(taskId, async (progress) => {
        const percentage = Math.round(progress * 100);
        const progressBar = this.createProgressBar(progress);
        progressEmbed.setFooter({ text: `${progressBar} ${percentage}% complete` }).setTimestamp();
        try { await interaction.editReply({ embeds: [progressEmbed] }); } catch {}
      });

      if (!result.videoUrl) {
        await this.requestTrackingService.setFailed(dbRequestId, 'No video_url returned by Wan');
        await interaction.editReply('❌ Generation completed but no video URL was returned.');
        return;
      }

      // Download + upload to GCS (stable)
      const buf = await this.wanService.downloadVideoToBuffer(result.videoUrl);
      const objectName = await this.wanService.uploadVideoToGcs(buf, outputUri, 'video_0.mp4');

      await this.storageService.makePublic(objectName);
      const publicUrls = [this.storageService.publicUrl(objectName)];

      await this.requestTrackingService.setCompleted(dbRequestId, publicUrls);

      const completionEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setDescription(`**${options.prompt}**`)
        .addFields(
          { name: 'Duration', value: `${options.length}s`, inline: true },
          { name: 'Aspect Ratio', value: options.ratio, inline: true },
          { name: 'Resolution', value: resolution, inline: true },
        )
        .setFooter({ text: `Fast mode • ${Math.max(rateLimitResult.remaining - 1, 0)}/5 remaining today` })
        .setTimestamp();

      // Attach video (reusing existing attachment service)
      const attachmentResult = await this.videoAttachmentService.attachVideoOrFallback(
        objectName,
        interaction,
        completionEmbed,
        dbRequestId,
      );

      if (attachmentResult.method === 'url') {
        const videoLinks = publicUrls.join('\n');
        await interaction.editReply({ content: videoLinks, embeds: [completionEmbed] });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      if (dbRequestId) {
        if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
          await this.requestTrackingService.setTimeout(dbRequestId);
        } else {
          await this.requestTrackingService.setFailed(dbRequestId, errorMessage);
        }
      }
      logger.error({ error, userId, guildId, channelId, requestId: dbRequestId }, 'Error executing /wan command');

      if (interaction.deferred) {
        await interaction.editReply(`❌ Failed to generate video: ${errorMessage}`);
      } else {
        await interaction.reply({ content: `❌ Failed: ${errorMessage}`, ephemeral: true });
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