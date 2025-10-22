import { z } from 'zod';

export const VeoCommandOptionsSchema = z.object({
  prompt: z
    .string()
    .min(5, 'Prompt must be at least 5 characters')
    .max(600, 'Prompt must not exceed 600 characters'),
  length: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
  ratio: z.union([z.literal('16:9'), z.literal('9:16')]).default('16:9'),
  hd: z.boolean().default(true),
  audio: z.boolean().default(true),
});

export type VeoCommandOptions = z.infer<typeof VeoCommandOptionsSchema>;

export const sanitizePathComponent = (input: string): string => {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_');
};

export const validatePromptContent = (prompt: string): { valid: boolean; reason?: string } => {
  const lowerPrompt = prompt.toLowerCase();

  // Basic content safety checks
  const bannedTerms = ['explicit', 'nsfw', 'gore', 'violence'];
  const hasBannedContent = bannedTerms.some((term) => lowerPrompt.includes(term));

  if (hasBannedContent) {
    return { valid: false, reason: 'Prompt contains potentially inappropriate content' };
  }

  return { valid: true };
};
