import Redis from 'ioredis';
import logger from '../logger/logger.js'

let redis;
const redisUrl =
  process.env.BACKEND_REDIS_URL || "redis://localhost:6379";

 logger.debug('redisUrl:', redisUrl);

if (
  redisUrl &&
  (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))
) {
  // Use as a standard Redis URL
  redis = new Redis(redisUrl, { connectTimeout: 500 });
} else {
  logger.error('BACKEND_REDIS_HOST environment variable is not set');
  throw new Error('BACKEND_REDIS_HOST environment variable is not set');
}

redis.on('ready', () => {
  logger.info('ioredis is ready and connected to Redis.');
 
});

redis.on('error', (err) => {
  logger.error('ioredis encountered an error:', err);
 
});

redis.on('reconnecting', () => {
  logger.error('ioredis is reconnecting to Redis...');
  //console.log('ioredis is reconnecting to Redis...');
});

// Health check function
export const checkRedisHealth = async () => {
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    logger.info(`✅ Redis connected successfully. Latency: ${latency}ms`);
 
    return {
      healthy: true,
      latency,
      connected: redis.status === 'ready',
    };
  } catch (error) {
    logger.error('ioredis health check failed:', error);
    return {
      healthy: false,
      error: error.message,
      connected: false,
    };
  }
};

export default redis;
