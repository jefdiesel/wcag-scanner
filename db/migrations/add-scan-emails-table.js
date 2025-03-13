// db/migrations/add-scan-emails-table.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const logger = require('../../utils/logger');

// Get database path from environment variables or use default
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/wcag_scanner.db');
console.log(`Using database at: ${dbPath}`);

// Create a database connection
const db = new sqlite3.Database(dbPath);

/**
 * Promisified database run function
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
 * Add scan_emails table for storing emails found during scans
 */
async function addScanEmailsTable() {
  try {
    console.log('Adding scan_emails table...');
    
    // Create the scan_emails table if it doesn't exist
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        emails TEXT NOT NULL,
        found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create an index for faster lookups
    await runAsync(`
      CREATE INDEX IF NOT EXISTS idx_scan_emails_scan_id ON scan_emails(scan_id)
    `);
    
    console.log('Successfully added scan_emails table');
    return true;
  } catch (error) {
    console.error(`Error adding scan_emails table: ${error.message}`);
    return false;
  } finally {
    // Close the database connection
    db.close();
  }
}

// Run the migration
addScanEmailsTable()
  .then((success) => {
    if (success) {
      console.log('Database update completed successfully!');
    } else {
      console.error('Database update failed!');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Unexpected error: ${error.message}`);
    process.exit(1);
  });
