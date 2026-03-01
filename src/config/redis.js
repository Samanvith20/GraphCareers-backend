import Redis from 'ioredis';

let redis;
const redisUrl = process.env.BACKEND_REDIS_URL;

 console.log('redisUrl:', redisUrl);

if (
  redisUrl &&
  (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))
) {
  // Use as a standard Redis URL
  redis = new Redis(redisUrl, { connectTimeout: 500 });
} else {
  console.error('BACKEND_REDIS_HOST environment variable is not set');
  throw new Error('BACKEND_REDIS_HOST environment variable is not set');
}

redis.on('ready', () => {
  console.info('ioredis is ready and connected to Redis.');
 
});

redis.on('error', (err) => {
  console.error('ioredis encountered an error:', err);
 
});

redis.on('reconnecting', () => {
  console.error('ioredis is reconnecting to Redis...');
  //console.log('ioredis is reconnecting to Redis...');
});

// Health check function
export const checkRedisHealth = async () => {
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    console.info(`✅ Redis connected successfully. Latency: ${latency}ms`);
    console.log(await redis.ping());
    return {
      healthy: true,
      latency,
      connected: redis.status === 'ready',
    };
  } catch (error) {
    console.error('ioredis health check failed:', error);
    console.error('ioredis encountered an error:', error);
    return {
      healthy: false,
      error: error.message,
      connected: false,
    };
  }
};

export default redis;
