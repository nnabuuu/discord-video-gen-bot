import { StorageService } from './storage.service';
import { Bucket, File } from '@google-cloud/storage';

jest.mock('../common/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('StorageService', () => {
  let service: StorageService;
  let mockBucket: jest.Mocked<Bucket>;
  let mockFile: jest.Mocked<File>;

  beforeEach(() => {
    service = new StorageService();

    const getMetadataMock = jest.fn();
    const downloadMock = jest.fn();

    mockFile = {
      getMetadata: getMetadataMock,
      download: downloadMock,
    } as any;

    mockBucket = {
      file: jest.fn().mockReturnValue(mockFile),
    } as any;

    (service as any).bucket = mockBucket;
    (service as any).bucketName = 'test-bucket';
  });

  describe('getFileMetadata', () => {
    it('should return file size in bytes', async () => {
      (mockFile.getMetadata as jest.Mock).mockResolvedValue([{ size: '12345' }]);

      const result = await service.getFileMetadata('test-file.mp4');

      expect(result).toEqual({ size: 12345 });
      expect(mockBucket.file).toHaveBeenCalledWith('test-file.mp4');
      expect(mockFile.getMetadata).toHaveBeenCalled();
    });

    it('should handle numeric size', async () => {
      (mockFile.getMetadata as jest.Mock).mockResolvedValue([{ size: 67890 }]);

      const result = await service.getFileMetadata('test-file.mp4');

      expect(result).toEqual({ size: 67890 });
    });

    it('should throw error when file not found', async () => {
      (mockFile.getMetadata as jest.Mock).mockRejectedValue(new Error('File not found'));

      await expect(service.getFileMetadata('missing.mp4')).rejects.toThrow('File not found');
    });

    it('should throw error on auth failure', async () => {
      (mockFile.getMetadata as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      await expect(service.getFileMetadata('test.mp4')).rejects.toThrow('Unauthorized');
    });
  });

  describe('downloadToBuffer', () => {
    it('should download file to buffer', async () => {
      const expectedBuffer = Buffer.from('video data');
      (mockFile.download as jest.Mock).mockResolvedValue([expectedBuffer]);

      const result = await service.downloadToBuffer('test-file.mp4');

      expect(result).toBe(expectedBuffer);
      expect(mockBucket.file).toHaveBeenCalledWith('test-file.mp4');
      expect(mockFile.download).toHaveBeenCalled();
    });

    it('should throw error when file not found', async () => {
      (mockFile.download as jest.Mock).mockRejectedValue(new Error('File not found'));

      await expect(service.downloadToBuffer('missing.mp4')).rejects.toThrow('File not found');
    });

    it('should throw error on network failure', async () => {
      (mockFile.download as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(service.downloadToBuffer('test.mp4')).rejects.toThrow('Network error');
    });
  });
});
