#!/usr/bin/env node

/**
 * WCAG Scanner Database Migration Script
 * 
 * This script updates the database schema by adding the error_message column
 * to the scan_results table, and performs other necessary database updates.
 * 
 * Usage: node db-migration.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Simple logger for migration script
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`)
};

// Path to the database
const dbPath = path.join(__dirname, 'data', 'wcag_scanner.db');

// Check if database file exists
if (!fs.existsSync(dbPath)) {
  logger.error(`Database file does not exist at ${dbPath}`);
  logger.info(`Creating data directory if it doesn't exist`);
  
  // Create data directory if it doesn't exist
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`Created data directory at ${dataDir}`);
  }
}

// Connect to the database
logger.info(`Connecting to database at ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error(`Failed to connect to database: ${err.message}`);
    process.exit(1);
  }
  logger.info(`Connected to database successfully`);
});

// Database query wrapper functions
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

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

// Main migration function
async function migrateDatabase() {
  try {
    logger.info('Starting database migration');

    // Create tables if they don't exist (for new installations)
    logger.info('Ensuring required tables exist');
    
    await runAsync(`
      CREATE TABLE IF NOT EXISTS queue (
        url TEXT PRIMARY KEY,
        max_pages INTEGER DEFAULT 100,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT,
        url TEXT,
        violations TEXT,
        links TEXT,
        status TEXT,
        scanned_at TIMESTAMP,
        report_pdf TEXT,
        report_csv TEXT
      )
    `);
    
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_email_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT,
        url TEXT,
        requester_email TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        report_sent INTEGER DEFAULT 0,
        report_sent_at TIMESTAMP,
        processing_error TEXT
      )
    `);

    // Check if the error_message column exists in scan_results table
    logger.info('Checking if error_message column exists in scan_results table');
    const columns = await allAsync("PRAGMA table_info(scan_results)");
    
    // Check if the error_message column exists
    const hasErrorMessage = columns.some(col => col.name === 'error_message');
    
    if (!hasErrorMessage) {
      logger.info('error_message column does not exist, adding it now');
      try {
        await runAsync('ALTER TABLE scan_results ADD COLUMN error_message TEXT');
        logger.info('Successfully added error_message column to scan_results table');
      } catch (alterError) {
        logger.error(`Failed to add error_message column: ${alterError.message}`);
        throw alterError;
      }
    } else {
      logger.info('error_message column already exists in scan_results table');
    }

    // Create indexes for better performance
    logger.info('Ensuring indexes exist');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_results_url ON scan_results(url)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_email_requests_scan_id ON scan_email_requests(scan_id)');

    // Create a migration history table to track changes
    logger.info('Creating migration history table');
    await runAsync(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Record this migration
    await runAsync(
      'INSERT INTO migration_history (migration_name) VALUES (?)',
      ['add_error_message_column']
    );

    logger.info('Database migration completed successfully');
    
    // Check queue for invalid URLs and clean them
    logger.info('Checking queue for invalid URLs');
    const queueItems = await allAsync('SELECT url FROM queue');
    if (queueItems && queueItems.length > 0) {
      logger.info(`Found ${queueItems.length} items in queue`);
      
      // Count URLs that end with a period
      const invalidUrls = queueItems.filter(item => 
        item.url.endsWith('.') || 
        item.url.endsWith('.The') || 
        item.url.includes('..') ||
        !item.url.match(/^https?:\/\//i)
      );
      
      if (invalidUrls.length > 0) {
        logger.warn(`Found ${invalidUrls.length} potentially invalid URLs in queue`);
        logger.info('Examples of invalid URLs:');
        invalidUrls.slice(0, 5).forEach(item => {
          logger.info(`- ${item.url}`);
        });
        
        // Ask for confirmation before cleaning
        logger.info('These URLs may be causing crawl loops. Do you want to clean them? (y/n)');
        // Since this is a script, we'll automatically clean them
        logger.info('Automatically cleaning invalid URLs...');
        
        let cleanedCount = 0;
        for (const item of invalidUrls) {
          try {
            await runAsync('DELETE FROM queue WHERE url = ?', [item.url]);
            cleanedCount++;
          } catch (deleteError) {
            logger.error(`Failed to delete URL ${item.url}: ${deleteError.message}`);
          }
        }
        
        logger.info(`Successfully cleaned ${cleanedCount} invalid URLs from queue`);
      } else {
        logger.info('No invalid URLs found in queue');
      }
    } else {
      logger.info('Queue is empty');
    }
    
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  } finally {
    // Close the database connection
    db.close((err) => {
      if (err) {
        logger.error(`Error closing database: ${err.message}`);
      } else {
        logger.info('Database connection closed');
      }
      process.exit(0);
    });
  }
}

// Execute the migration
migrateDatabase();
