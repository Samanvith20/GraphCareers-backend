import { createLogger, format, transports } from 'winston';

const serviceName = 'backend-api';
const env = process.env.BACKEND_NODE_ENV || 'production';
const isDev = env !== 'production';

// In production → info and above; in dev → debug and above
const LOG_LEVEL = isDev ? 'debug' : 'info';

// ─── Production format: structured JSON (Loki/Grafana parseable) ──────────────
const jsonFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  format.errors({ stack: true }),
  format.json(),
);

// ─── Development format: human-readable colourized output ────────────────────
const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ level, message, timestamp, service, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ' ' + JSON.stringify(meta)
      : '';
    return `${timestamp} [${serviceName}] ${level}: ${message}${metaStr}`;
  }),
);

// ─── Base Winston logger ──────────────────────────────────────────────────────
const baseLogger = createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: serviceName, env },
  format: isDev ? devFormat : jsonFormat,
  transports: [new transports.Console()],
});

// ─── Proxy: support logger.info("message", { meta }) cleanly ─────────────────
//
// Winston natively handles logger.info("msg", { key: value }) but
// we proxy to support legacy callers who pass raw objects as second arg.
// This keeps metadata as structured fields (not stringified text) so
// Loki/Grafana can filter by requestId, userId, etc.
//
const LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

const logger = new Proxy(baseLogger, {
  get(target, prop) {
    if (LEVELS.includes(prop)) {
      return (message, meta = {}) => {
        if (typeof message !== 'string') {
          // Called as logger.error(errObject) — extract message + stack
          const err = message;
          return target[prop](err?.message ?? String(err), {
            ...(typeof meta === 'object' ? meta : {}),
            ...(err?.stack ? { stack: err.stack } : {}),
          });
        }
        // Normal call: logger.info("msg", { requestId, userId })
        return target[prop](message, typeof meta === 'object' ? meta : { raw: meta });
      };
    }
    return target[prop];
  },
});

export default logger;
