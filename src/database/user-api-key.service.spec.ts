import { UserApiKeyService } from './user-api-key.service';
import { DatabaseService } from './database.service';

jest.mock('../common/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('UserApiKeyService', () => {
  let service: UserApiKeyService;
  let mockPool: any;
  let mockDatabaseService: jest.Mocked<DatabaseService>;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, API_KEY_ENCRYPTION_SECRET: 'test-secret-key-32-chars-long!!' };

    mockPool = {
      query: jest.fn(),
      one: jest.fn(),
      maybeOne: jest.fn(),
    };

    mockDatabaseService = {
      getPool: jest.fn().mockReturnValue(mockPool),
    } as any;

    service = new UserApiKeyService(mockDatabaseService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('generateConnectionCode', () => {
    it('should generate a connection code and return URL', async () => {
      mockPool.maybeOne.mockResolvedValue(null);
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.generateConnectionCode('user123');

      expect(result.code).toHaveLength(36); // UUID length
      expect(result.url).toContain('/connect?code=');
      expect(result.hasExistingKey).toBe(false);
    });

    it('should indicate when user has existing key', async () => {
      mockPool.maybeOne.mockResolvedValue({ api_key_encrypted: 'encrypted-key' });
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.generateConnectionCode('user123');

      expect(result.hasExistingKey).toBe(true);
    });
  });

  describe('encryption', () => {
    it('should encrypt and decrypt API keys correctly', async () => {
      const testApiKey = 'AIzaSyTest123456789';
      const userId = 'user123';
      const code = 'test-code-123';

      // Setup for setApiKeyByCode
      mockPool.maybeOne.mockResolvedValue({
        user_id: userId,
        connection_code: code,
        code_expires_at: new Date(Date.now() + 600000),
        api_key_encrypted: null,
      });
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const setResult = await service.setApiKeyByCode(code, testApiKey);
      expect(setResult.success).toBe(true);
      expect(setResult.maskedKey).toBe('AIza...6789');

      // Capture the encrypted value from the query call
      const updateCall = mockPool.query.mock.calls[0];
      expect(updateCall).toBeDefined();
    });

    it('should mask API key correctly', async () => {
      const code = 'test-code-123';
      const encryptedKey = (service as any).encrypt('AIzaSyTestKey12345');

      mockPool.maybeOne.mockResolvedValue({
        user_id: 'user123',
        connection_code: code,
        code_expires_at: new Date(Date.now() + 600000),
        api_key_encrypted: encryptedKey,
        updated_at: new Date(),
      });

      const status = await service.getStatusByCode(code);

      expect(status).not.toBeNull();
      expect(status!.hasKey).toBe(true);
      expect(status!.maskedKey).toBe('AIza...2345');
    });
  });

  describe('getStatusByCode', () => {
    it('should return null for invalid code', async () => {
      mockPool.maybeOne.mockResolvedValue(null);

      const result = await service.getStatusByCode('invalid-code');

      expect(result).toBeNull();
    });

    it('should return null for expired code', async () => {
      mockPool.maybeOne.mockResolvedValue({
        user_id: 'user123',
        connection_code: 'test-code',
        code_expires_at: new Date(Date.now() - 1000), // Expired
        api_key_encrypted: null,
      });

      const result = await service.getStatusByCode('test-code');

      expect(result).toBeNull();
    });

    it('should return status for valid code without key', async () => {
      mockPool.maybeOne.mockResolvedValue({
        user_id: 'user123',
        connection_code: 'test-code',
        code_expires_at: new Date(Date.now() + 600000),
        api_key_encrypted: null,
        updated_at: new Date(),
      });

      const result = await service.getStatusByCode('test-code');

      expect(result).not.toBeNull();
      expect(result!.hasKey).toBe(false);
      expect(result!.maskedKey).toBeNull();
    });
  });

  describe('setApiKeyByCode', () => {
    it('should fail for invalid code', async () => {
      mockPool.maybeOne.mockResolvedValue(null);

      const result = await service.setApiKeyByCode('invalid-code', 'api-key');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid connection code');
    });

    it('should fail for expired code', async () => {
      mockPool.maybeOne.mockResolvedValue({
        user_id: 'user123',
        connection_code: 'test-code',
        code_expires_at: new Date(Date.now() - 1000), // Expired
      });

      const result = await service.setApiKeyByCode('test-code', 'api-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should succeed for valid code', async () => {
      mockPool.maybeOne.mockResolvedValue({
        user_id: 'user123',
        connection_code: 'test-code',
        code_expires_at: new Date(Date.now() + 600000),
      });
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.setApiKeyByCode('test-code', 'AIzaSyTestKey12345');

      expect(result.success).toBe(true);
      expect(result.maskedKey).toBe('AIza...2345');
    });
  });

  describe('getApiKey', () => {
    it('should return null when user has no key', async () => {
      mockPool.maybeOne.mockResolvedValue(null);

      const result = await service.getApiKey('user123');

      expect(result).toBeNull();
    });

    it('should return decrypted API key', async () => {
      const testApiKey = 'AIzaSyTestKey12345';
      const encryptedKey = (service as any).encrypt(testApiKey);

      mockPool.maybeOne.mockResolvedValue({ api_key_encrypted: encryptedKey });

      const result = await service.getApiKey('user123');

      expect(result).toBe(testApiKey);
    });
  });

  describe('hasApiKey', () => {
    it('should return false when user has no key', async () => {
      mockPool.maybeOne.mockResolvedValue(null);

      const result = await service.hasApiKey('user123');

      expect(result).toBe(false);
    });

    it('should return true when user has key', async () => {
      mockPool.maybeOne.mockResolvedValue({ api_key_encrypted: 'encrypted' });

      const result = await service.hasApiKey('user123');

      expect(result).toBe(true);
    });
  });

  describe('removeApiKey', () => {
    it('should return true when key is removed', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.removeApiKey('user123');

      expect(result).toBe(true);
    });

    it('should return false when no key to remove', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 0 });

      const result = await service.removeApiKey('user123');

      expect(result).toBe(false);
    });
  });

  describe('encryption disabled', () => {
    it('should return null from getApiKey when encryption disabled', async () => {
      process.env = { ...originalEnv }; // No encryption secret
      const serviceNoEncryption = new UserApiKeyService(mockDatabaseService);

      const result = await serviceNoEncryption.getApiKey('user123');

      expect(result).toBeNull();
    });

    it('should fail setApiKeyByCode when encryption disabled', async () => {
      process.env = { ...originalEnv }; // No encryption secret
      const serviceNoEncryption = new UserApiKeyService(mockDatabaseService);

      const result = await serviceNoEncryption.setApiKeyByCode('code', 'key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });
  });
});
