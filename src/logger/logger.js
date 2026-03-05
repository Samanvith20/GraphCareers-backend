import { createLogger, format, transports } from 'winston';
import util from 'util';

const serviceName = 'backend-api';
const env = process.env.BACKEND_NODE_ENV || 'production';

const LOG_LEVEL = env === 'production' ? 'info' : 'silly';


// 🎯 1. Base Winston logger
const baseLogger = createLogger({
  level: LOG_LEVEL,
   defaultMeta: { service: serviceName },
  format: format.combine(
    format.timestamp({
      format: () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    }),
    format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [${serviceName}] (${env}) [${level}]: ${message}`;
    }),
    format.json()
  ),
  transports: [new transports.Console()],
});

// 🎯 2. Wrap to support multiple args like console.log
const allLevels = [
  'error',
  'warn',
  'info',
  'http',
  'verbose',
  'debug',
  'silly',
  'log', // allow plain logger.log()
];

const logger = new Proxy(baseLogger, {
  get(target, prop) {
    const orig = target[prop];
    if (allLevels.includes(prop)) {
      return (...args) => {
        const message = args
          .map((a) =>
            typeof a === 'object' ? util.inspect(a, { depth: null, colors: false }) : String(a)
          )
          .join(' ');
        // For 'log', default to info level
        const level = prop === 'log' ? 'info' : prop;
        return target.log(level, message);
      };
    }
    return orig;
  },
});

export default logger;
