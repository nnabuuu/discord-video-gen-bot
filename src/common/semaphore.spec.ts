import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  describe('acquire and release', () => {
    it('should allow immediate acquisition when permits available', async () => {
      const semaphore = new Semaphore(2);
      await expect(semaphore.acquire()).resolves.toBeUndefined();
      expect(semaphore.getAvailablePermits()).toBe(1);
    });

    it('should release permit correctly', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(0);
      semaphore.release();
      expect(semaphore.getAvailablePermits()).toBe(1);
    });

    it('should queue requests when permits exhausted', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      const acquirePromise = semaphore.acquire();
      expect(semaphore.getQueueDepth()).toBe(1);

      semaphore.release();
      await expect(acquirePromise).resolves.toBeUndefined();
      expect(semaphore.getQueueDepth()).toBe(0);
    });

    it('should handle FIFO queue order', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      const order: number[] = [];
      const promise1 = semaphore.acquire().then(() => order.push(1));
      const promise2 = semaphore.acquire().then(() => order.push(2));
      const promise3 = semaphore.acquire().then(() => order.push(3));

      expect(semaphore.getQueueDepth()).toBe(3);

      semaphore.release();
      await promise1;
      expect(order).toEqual([1]);

      semaphore.release();
      await promise2;
      expect(order).toEqual([1, 2]);

      semaphore.release();
      await promise3;
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('timeout', () => {
    it('should timeout after specified duration', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      await expect(semaphore.acquire(100)).rejects.toThrow(
        'Semaphore acquire timeout after 100ms',
      );
      expect(semaphore.getQueueDepth()).toBe(0);
    });

    it('should remove timed-out request from queue', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      const promise1 = semaphore.acquire(100);
      const promise2 = semaphore.acquire(5000);

      await expect(promise1).rejects.toThrow('timeout');
      expect(semaphore.getQueueDepth()).toBe(1);

      semaphore.release();
      await expect(promise2).resolves.toBeUndefined();
    });

    it('should use default timeout of 30s', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      const start = Date.now();
      const promise = semaphore.acquire();

      // Release quickly to avoid waiting 30s
      setTimeout(() => semaphore.release(), 10);
      await promise;

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('runExclusive', () => {
    it('should acquire and release automatically on success', async () => {
      const semaphore = new Semaphore(1);
      const result = await semaphore.runExclusive(async () => {
        expect(semaphore.getAvailablePermits()).toBe(0);
        return 'success';
      });

      expect(result).toBe('success');
      expect(semaphore.getAvailablePermits()).toBe(1);
    });

    it('should release permit even on error', async () => {
      const semaphore = new Semaphore(1);

      await expect(
        semaphore.runExclusive(async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      expect(semaphore.getAvailablePermits()).toBe(1);
    });

    it('should handle concurrent runExclusive calls', async () => {
      const semaphore = new Semaphore(2);
      const results: number[] = [];

      await Promise.all([
        semaphore.runExclusive(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          results.push(1);
        }),
        semaphore.runExclusive(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          results.push(2);
        }),
        semaphore.runExclusive(async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          results.push(3);
        }),
      ]);

      expect(results).toHaveLength(3);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
      expect(semaphore.getAvailablePermits()).toBe(2);
    });
  });

  describe('metrics', () => {
    it('should report queue depth correctly', async () => {
      const semaphore = new Semaphore(1);
      await semaphore.acquire();

      expect(semaphore.getQueueDepth()).toBe(0);

      const p1 = semaphore.acquire();
      expect(semaphore.getQueueDepth()).toBe(1);

      const p2 = semaphore.acquire();
      expect(semaphore.getQueueDepth()).toBe(2);

      semaphore.release();
      await p1;
      expect(semaphore.getQueueDepth()).toBe(1);

      semaphore.release();
      await p2;
      expect(semaphore.getQueueDepth()).toBe(0);
    });

    it('should report available permits correctly', () => {
      const semaphore = new Semaphore(5);
      expect(semaphore.getAvailablePermits()).toBe(5);
    });
  });
});
