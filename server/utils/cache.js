// Simple in-memory cache for API responses
class Cache {
    constructor(ttl = 300000) { // 5 minutes default
        this.cache = new Map();
        this.ttl = ttl;
    }

    set(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    clear() {
        this.cache.clear();
    }

    delete(key) {
        this.cache.delete(key);
    }
}

export const apiCache = new Cache();

export const cacheMiddleware = (duration = 300000) => {
    return (req, res, next) => {
        if (req.method !== 'GET') {
            return next();
        }

        const key = req.originalUrl;
        const cachedResponse = apiCache.get(key);

        if (cachedResponse) {
            return res.json(cachedResponse);
        }

        const originalJson = res.json.bind(res);
        res.json = (body) => {
            apiCache.set(key, body);
            return originalJson(body);
        };

        next();
    };
};
