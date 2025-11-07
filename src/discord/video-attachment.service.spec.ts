import { VideoAttachmentService } from './video-attachment.service';
import { StorageService } from '../storage/storage.service';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

jest.mock('../common/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('VideoAttachmentService', () => {
  let service: VideoAttachmentService;
  let mockStorageService: jest.Mocked<StorageService>;
  let mockInteraction: jest.Mocked<ChatInputCommandInteraction>;
  let mockEmbed: EmbedBuilder;

  beforeEach(() => {
    mockStorageService = {
      getFileMetadata: jest.fn(),
      downloadToBuffer: jest.fn(),
      publicUrl: jest.fn((objectName) => `https://storage.googleapis.com/test-bucket/${objectName}`),
    } as any;

    mockInteraction = {
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockEmbed = new EmbedBuilder();

    service = new VideoAttachmentService(mockStorageService);
  });

  describe('attachVideoOrFallback', () => {
    it('should successfully attach video under 25MB', async () => {
      const buffer = Buffer.from('video data');
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 }); // 10MB
      mockStorageService.downloadToBuffer.mockResolvedValue(buffer);

      const result = await service.attachVideoOrFallback(
        'test-video.mp4',
        mockInteraction,
        mockEmbed,
        'request-123',
      );

      expect(result.method).toBe('attached');
      expect(result.reason).toBeUndefined();
      expect(mockStorageService.getFileMetadata).toHaveBeenCalledWith('test-video.mp4');
      expect(mockStorageService.downloadToBuffer).toHaveBeenCalledWith('test-video.mp4');
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        files: expect.arrayContaining([
          expect.objectContaining({
            attachment: buffer,
            name: 'test-video.mp4',
          }),
        ]),
        embeds: [mockEmbed],
      });
    });

    it('should fallback to URL for video exceeding 25MB', async () => {
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 30 * 1024 * 1024 }); // 30MB

      const result = await service.attachVideoOrFallback(
        'large-video.mp4',
        mockInteraction,
        mockEmbed,
        'request-123',
      );

      expect(result.method).toBe('url');
      expect(result.reason).toBe('size_exceeded');
      expect(result.url).toBe('https://storage.googleapis.com/test-bucket/large-video.mp4');
      expect(mockStorageService.downloadToBuffer).not.toHaveBeenCalled();
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });

    it('should fallback to URL on download error', async () => {
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockRejectedValue(new Error('Failed to download file'));

      const result = await service.attachVideoOrFallback(
        'error-video.mp4',
        mockInteraction,
        mockEmbed,
        'request-123',
      );

      expect(result.method).toBe('url');
      expect(result.reason).toBe('download_error');
      expect(result.url).toBe('https://storage.googleapis.com/test-bucket/error-video.mp4');
    });

    it('should fallback to URL on metadata fetch error', async () => {
      mockStorageService.getFileMetadata.mockRejectedValue(new Error('File not found'));

      const result = await service.attachVideoOrFallback(
        'missing-video.mp4',
        mockInteraction,
        mockEmbed,
        'request-123',
      );

      expect(result.method).toBe('url');
      expect(result.reason).toBe('download_error');
      expect(result.url).toBe('https://storage.googleapis.com/test-bucket/missing-video.mp4');
    });

    it('should fallback to URL on Discord API error', async () => {
      const buffer = Buffer.from('video data');
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockResolvedValue(buffer);
      mockInteraction.editReply.mockRejectedValue(new Error('Discord API error'));

      const result = await service.attachVideoOrFallback(
        'test-video.mp4',
        mockInteraction,
        mockEmbed,
        'request-123',
      );

      expect(result.method).toBe('url');
      expect(result.reason).toBe('discord_error');
      expect(result.url).toBe('https://storage.googleapis.com/test-bucket/test-video.mp4');
    });

    it('should handle concurrency timeout', async () => {
      // Set very low concurrency limit for testing
      process.env.MAX_CONCURRENT_ATTACHMENTS = '1';
      const service2 = new VideoAttachmentService(mockStorageService);

      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(Buffer.from('data')), 100)),
      );

      // Start first request (acquires the only slot)
      const promise1 = service2.attachVideoOrFallback(
        'video1.mp4',
        mockInteraction,
        mockEmbed,
        'req-1',
      );

      // Start second request with very short timeout (should timeout)
      // Manually mock the semaphore to reject with timeout
      const originalAcquire = (service2 as any).downloadSemaphore.acquire;
      (service2 as any).downloadSemaphore.acquire = jest
        .fn()
        .mockRejectedValue(new Error('Semaphore acquire timeout after 100ms'));

      const result2 = await service2.attachVideoOrFallback(
        'video2.mp4',
        mockInteraction,
        mockEmbed,
        'req-2',
      );

      expect(result2.method).toBe('url');
      expect(result2.reason).toBe('concurrency_timeout');

      // Restore and wait for first to complete
      (service2 as any).downloadSemaphore.acquire = originalAcquire;
      await promise1;

      delete process.env.MAX_CONCURRENT_ATTACHMENTS;
    });

    it('should release semaphore on successful attachment', async () => {
      const buffer = Buffer.from('video data');
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockResolvedValue(buffer);

      const semaphore = (service as any).downloadSemaphore;
      const initialPermits = semaphore.getAvailablePermits();

      await service.attachVideoOrFallback('test-video.mp4', mockInteraction, mockEmbed);

      // After completion, permits should be restored
      expect(semaphore.getAvailablePermits()).toBe(initialPermits);
    });

    it('should release semaphore even on error (critical path)', async () => {
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockRejectedValue(new Error('Download failed'));

      const semaphore = (service as any).downloadSemaphore;
      const initialPermits = semaphore.getAvailablePermits();

      await service.attachVideoOrFallback('test-video.mp4', mockInteraction, mockEmbed);

      // Even after error, permits should be restored
      expect(semaphore.getAvailablePermits()).toBe(initialPermits);
    });

    it('should handle concurrent requests up to limit', async () => {
      process.env.MAX_CONCURRENT_ATTACHMENTS = '3';
      const service3 = new VideoAttachmentService(mockStorageService);

      const buffer = Buffer.from('video data');
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockResolvedValue(buffer);

      // Start 3 concurrent requests (should all succeed)
      const promises = [
        service3.attachVideoOrFallback('video1.mp4', mockInteraction, mockEmbed),
        service3.attachVideoOrFallback('video2.mp4', mockInteraction, mockEmbed),
        service3.attachVideoOrFallback('video3.mp4', mockInteraction, mockEmbed),
      ];

      const results = await Promise.all(promises);

      expect(results.every((r) => r.method === 'attached')).toBe(true);
      expect(mockStorageService.downloadToBuffer).toHaveBeenCalledTimes(3);

      delete process.env.MAX_CONCURRENT_ATTACHMENTS;
    });

    it('should extract filename from object path', async () => {
      const buffer = Buffer.from('video data');
      mockStorageService.getFileMetadata.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockStorageService.downloadToBuffer.mockResolvedValue(buffer);

      await service.attachVideoOrFallback(
        'discord/guild/channel/user/request/my-video.mp4',
        mockInteraction,
        mockEmbed,
      );

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        files: expect.arrayContaining([
          expect.objectContaining({
            name: 'my-video.mp4',
          }),
        ]),
        embeds: [mockEmbed],
      });
    });
  });
});
