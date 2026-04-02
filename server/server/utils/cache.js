// Simple in-memory cache for API responses
const cache = new Map();

const CACHE_TTL = {
    SHORT: 30 * 1000,    // 30 seconds
    MEDIUM: 5 * 60 * 1000,  // 5 minutes
    LONG: 15 * 60 * 1000,   // 15 minutes
};

/**
 * Get cached data if not expired
 * @param {string} key - Cache key
 * @returns {any|null} Cached data or null if expired/missing
 */
const get = (key) => {
    const cached = cache.get(key);
    if (!cached) return null;
    
    if (Date.now() > cached.expiresAt) {
        cache.delete(key);
        return null;
    }
    
    return cached.data;
};

/**
 * Set cache data with expiry
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in milliseconds
 */
const set = (key, data, ttl = CACHE_TTL.MEDIUM) => {
    cache.set(key, {
        data,
        expiresAt: Date.now() + ttl
    });
};

/**
 * Delete cache by key
 * @param {string} key - Cache key
 */
const del = (key) => {
    cache.delete(key);
};

/**
 * Clear all cache
 */
const clear = () => {
    cache.clear();
};

/**
 * Cache middleware for Express
 * @param {string} keyPrefix - Prefix for cache key
 * @param {number} ttl - Time to live in milliseconds
 * @returns {Function} Express middleware
 */
const cacheMiddleware = (keyPrefix, ttl = CACHE_TTL.MEDIUM) => {
    return (req, res, next) => {
        // Skip if not GET request
        if (req.method !== 'GET') {
            return next();
        }
        
        // Create cache key from URL
        const cacheKey = `${keyPrefix}:${req.originalUrl}`;
        
        // Check cache
        const cachedData = get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }
        
        // Override res.json to cache the response
        const originalJson = res.json;
        res.json = (data) => {
            set(cacheKey, data, ttl);
            return originalJson.call(res, data);
        };
        
        next();
    };
};

// Periodic cleanup of expired cache (every 5 minutes)
setInterval(() => {
    let deleted = 0;
    cache.forEach((value, key) => {
        if (Date.now() > value.expiresAt) {
            cache.delete(key);
            deleted++;
        }
    });
    if (deleted > 0) {
        console.log(`🗑️ Cache cleanup: removed ${deleted} expired entries`);
    }
}, 5 * 60 * 1000);

export default {
    get,
    set,
    del,
    clear,
    middleware: cacheMiddleware,
    CACHE_TTL
};
