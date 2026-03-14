const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { config } = require('./config');

const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'codespace-manager',
    env: config.nodeEnv,
  },
  transports: [
    new winston.transports.Console({
      format: config.nodeEnv === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} ${level}: ${message}${extra}`;
            })
          )
        : winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
    }),
    new winston.transports.File({ filename: path.join(logsDir, 'app.log') }),
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
  ],
});

module.exports = logger;
