/**
 * Semaphore for limiting concurrent operations
 */
export class Semaphore {
  private permits: number;
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void; timeout?: NodeJS.Timeout }> = [];

  constructor(private readonly maxPermits: number) {
    this.permits = maxPermits;
  }

  /**
   * Acquire a permit with optional timeout
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns Promise that resolves when permit is acquired
   * @throws Error if timeout is reached
   */
  async acquire(timeoutMs: number = 30000): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex((item) => item.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error(`Semaphore acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.queue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release a permit
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        if (next.timeout) {
          clearTimeout(next.timeout);
        }
        next.resolve();
      }
    } else {
      this.permits++;
    }
  }

  /**
   * Run a function with automatic permit acquisition and release
   * @param fn - Function to run exclusively
   * @returns Promise with function result
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current queue depth (for metrics/debugging)
   */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /**
   * Get available permits (for metrics/debugging)
   */
  getAvailablePermits(): number {
    return this.permits;
  }
}
