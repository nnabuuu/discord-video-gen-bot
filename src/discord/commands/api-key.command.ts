import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { logger } from '../../common/logger';
import { UserApiKeyService } from '../../database/user-api-key.service';

export class ApiKeyCommand {
  public static readonly data = new SlashCommandBuilder()
    .setName('api-key')
    .setDescription('Manage your SightAI API key for unlimited /banana image generation')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Check your API key connection status'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('connect')
        .setDescription('Generate a link to connect your SightAI API key'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disconnect')
        .setDescription('Remove your connected API key'),
    );

  constructor(private readonly userApiKeyService: UserApiKeyService) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    try {
      switch (subcommand) {
        case 'status':
          await this.handleStatus(interaction, userId);
          break;
        case 'connect':
          await this.handleConnect(interaction, userId);
          break;
        case 'disconnect':
          await this.handleDisconnect(interaction, userId);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          userId,
          subcommand,
        },
        'Error executing /api-key command',
      );

      const errorMessage = interaction.replied || interaction.deferred
        ? interaction.editReply.bind(interaction)
        : (content: string) => interaction.reply({ content, ephemeral: true });

      await errorMessage('❌ An error occurred. Please try again.');
    }
  }

  private async handleStatus(
    interaction: ChatInputCommandInteraction,
    userId: string,
  ): Promise<void> {
    const status = await this.userApiKeyService.getStatusByUserId(userId);

    const embed = new EmbedBuilder()
      .setTitle('API Key Status')
      .setTimestamp();

    if (status.hasKey) {
      embed
        .setColor(Colors.Green)
        .setDescription('Your SightAI API key is connected.')
        .addFields(
          { name: 'API Key', value: `\`${status.maskedKey}\``, inline: true },
          {
            name: 'Connected',
            value: status.connectedAt
              ? `<t:${Math.floor(new Date(status.connectedAt).getTime() / 1000)}:R>`
              : 'Unknown',
            inline: true,
          },
        )
        .setFooter({ text: 'Your API key is used when free credits are exhausted' });
    } else {
      embed
        .setColor(Colors.Grey)
        .setDescription('No API key connected.')
        .addFields({
          name: 'How to connect',
          value: 'Use `/api-key connect` to bind your SightAI API key and unlock unlimited image generation.',
        });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleConnect(
    interaction: ChatInputCommandInteraction,
    userId: string,
  ): Promise<void> {
    const result = await this.userApiKeyService.generateConnectionCode(userId);

    const embed = new EmbedBuilder()
      .setTitle('Connect Your API Key')
      .setColor(Colors.Blue)
      .setDescription('Click the link below to connect your SightAI API key.')
      .addFields(
        {
          name: 'Connection URL',
          value: `[Open Connection Page](${result.url})`,
        },
        {
          name: 'Expires',
          value: '<t:' + Math.floor((Date.now() + 10 * 60 * 1000) / 1000) + ':R>',
          inline: true,
        },
      )
      .setFooter({ text: 'This link is private and expires in 10 minutes' })
      .setTimestamp();

    if (result.hasExistingKey) {
      embed.addFields({
        name: '⚠️ Note',
        value: 'You already have an API key connected. Submitting a new key will replace it.',
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });

    logger.info(
      { userId, hasExistingKey: result.hasExistingKey },
      'Connection code generated',
    );
  }

  private async handleDisconnect(
    interaction: ChatInputCommandInteraction,
    userId: string,
  ): Promise<void> {
    const hasKey = await this.userApiKeyService.hasApiKey(userId);

    if (!hasKey) {
      await interaction.reply({
        content: '❌ No API key is connected to your account.',
        ephemeral: true,
      });
      return;
    }

    const removed = await this.userApiKeyService.removeApiKey(userId);

    if (removed) {
      const embed = new EmbedBuilder()
        .setTitle('API Key Disconnected')
        .setColor(Colors.Orange)
        .setDescription('Your SightAI API key has been removed.')
        .addFields({
          name: 'What now?',
          value: 'You can still use `/banana` with free credits (5/day). Use `/api-key connect` to reconnect an API key anytime.',
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      logger.info({ userId }, 'API key disconnected by user');
    } else {
      await interaction.reply({
        content: '❌ Failed to disconnect API key. Please try again.',
        ephemeral: true,
      });
    }
  }
}
