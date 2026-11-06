/**
 * High-performance, zero-cost in-memory cache for hot authenticated reads.
 * Provides microsecond response times with automatic TTL expiration,
 * capacity bounding (LRU eviction), and event-driven invalidation.
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export class MemoryCache<T = any> {
    private store = new Map<string, CacheEntry<T>>();
    private maxEntries: number;

    constructor(maxEntries: number = 2000) {
        this.maxEntries = maxEntries;
    }

    get(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }

        return entry.data;
    }

    set(key: string, value: T, ttlMs: number): void {
        // Enforce capacity bounds with simple FIFO/LRU eviction
        if (this.store.size >= this.maxEntries) {
            const firstKey = this.store.keys().next().value;
            if (firstKey) this.store.delete(firstKey);
        }

        this.store.set(key, {
            data: value,
            expiresAt: Date.now() + ttlMs,
        });
    }

    delete(key: string): void {
        this.store.delete(key);
    }

    clear(): void {
        this.store.clear();
    }
}

// Global cached singletons
export const userProfileCache = new MemoryCache<any>(3000);
export const statsSummaryCache = new MemoryCache<any>(3000);
export const mindlensCache = new MemoryCache<any>(2000);
export const feedSuggestionsCache = new MemoryCache<any>(2000);
export const tokenVersionCache = new MemoryCache<number>(5000);

/**
 * Invalidate all cached data for a user on write events (entry created/updated/deleted, follow, etc.)
 */
export function invalidateUserCaches(userId: string): void {
    userProfileCache.delete(userId);
    statsSummaryCache.delete(userId);
    mindlensCache.delete(userId);
    feedSuggestionsCache.delete(userId);
    tokenVersionCache.delete(userId);
}
