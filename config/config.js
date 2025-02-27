/**
 * Application configuration settings
 */
module.exports = {
  // Server configuration
  PORT: process.env.PORT || 3000,
  
  // Database configuration
  DB_PATH: process.env.DB_PATH || './data/wcag_scanner.db',
  
  // Scanner configuration
  PLAYWRIGHT_TIMEOUT: 60000, // 60 seconds
  PLAYWRIGHT_ARGS: ['--no-sandbox', '--disable-setuid-sandbox'],
  DEFAULT_MAX_PAGES: 1000000,
  MAX_CONCURRENT_SCANS: 2, // How many scans can run at once
  
  // Report configuration
  REPORT_DIR: './public/reports',
  
  // Logging configuration
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
