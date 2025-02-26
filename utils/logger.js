const { createLogger, format, transports } = require('winston');
const { LOG_LEVEL } = require('../config/config');
const path = require('path');
const fs = require('fs');

// Ensure log directory exists
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define custom format
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

// Create logger instance
const logger = createLogger({
  level: LOG_LEVEL,
  format: logFormat,
  defaultMeta: { service: 'wcag-scanner' },
  transports: [
    // Write logs to console
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(
          ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`
        )
      )
    }),
    // Write error logs to file
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to file
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

module.exports = logger;
