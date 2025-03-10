const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('../config/config');
const logger = require('../utils/logger');

// Make sure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error(`Database connection error: ${err.message}`);
    throw err;
  }
  logger.info(`Connected to SQLite database at ${DB_PATH}`);
});

/**
 * Promisified database query for single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} - Single row result
 */
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

/**
 * Promisified database query for multiple rows
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} - Array of row results
 */
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Promisified database run
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} - Result object
 */
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

/**
 * Initialize the database schema
 */
async function initDatabase() {
  try {
    logger.info('Initializing database schema...');
    
    // Create scan_results table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_results (
        scan_id TEXT,
        url TEXT,
        violations TEXT,
        links TEXT,
        status TEXT,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        report_pdf TEXT,
        report_csv TEXT
      )
    `);
    
    // Create queue table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS queue (
        url TEXT PRIMARY KEY, 
        max_pages INTEGER DEFAULT 1000
      )
    `);
    
    logger.info('Database initialization complete');
  } catch (error) {
    logger.error(`Database initialization failed: ${error.stack}`);
    throw error;
  }
}

module.exports = {
  db,
  getAsync,
  allAsync,
  runAsync,
  initDatabase,
};
