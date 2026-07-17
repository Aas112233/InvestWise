/**
 * Lightweight in-memory TTL cache.
 *
 * Designed for single-process deployments. In a multi-instance environment
 * (Vercel, scaled Render), swap the backing store to Redis/Upstash for
 * shared cache invalidation across instances.
 *
 * @example
 *   import { cache } from '../lib/cache.js';
 *   const stats = await cache.get('analytics:stats', async () => {
 *     return analyticsService.recalculateAllStats();
 *   }, 300_000); // 5 min TTL
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  /** Retrieve a cached value. Returns undefined if missing or expired. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  /**
   * Get-or-fill pattern: returns cached value if fresh, otherwise
   * calls `factory()`, caches the result with `ttlMs`, and returns it.
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Store a value with a TTL in milliseconds. */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Explicitly remove an entry (invalidation). */
  del(key: string): void {
    this.store.delete(key);
  }

  /** Pattern-based invalidation (deletes keys starting with prefix). */
  delByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Stats for monitoring. */
  stats(): { size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%',
    };
  }
}

export const cache = new TTLCache();
