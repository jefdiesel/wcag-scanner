// add-emails-column.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Get database path from environment variables or use default
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data/wcag_scanner.db');
console.log(`Using database at: ${dbPath}`);

// Create a database connection
const db = new sqlite3.Database(dbPath);

// Simple logger
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Run SQL with logging
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    log(`Executing: ${sql}`);
    db.run(sql, params, function(err) {
      if (err) {
        log(`Error: ${err.message}`);
        reject(err);
        return;
      }
      log(`Done. Changes: ${this.changes}`);
      resolve(this);
    });
  });
}

// Fix the database by adding the missing emails column
async function fixDatabase() {
  try {
    // Step 1: Check if emails column exists in scan_results
    log("Checking if emails column exists in scan_results table...");
    const columns = await new Promise((resolve, reject) => {
      db.all("PRAGMA table_info(scan_results)", (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.name));
      });
    });
    
    if (!columns.includes('emails')) {
      log("Adding emails column to scan_results table...");
      await run('ALTER TABLE scan_results ADD COLUMN emails TEXT DEFAULT NULL');
      log("Column added successfully.");
    } else {
      log("emails column already exists in scan_results table.");
    }

    // Step 2: Make sure scan_emails table exists
    log("Ensuring scan_emails table exists...");
    await run(`
      CREATE TABLE IF NOT EXISTS scan_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        emails TEXT NOT NULL,
        found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create an index for faster lookups
    log("Creating index on scan_emails table...");
    await run('CREATE INDEX IF NOT EXISTS idx_scan_emails_scan_id ON scan_emails(scan_id)');

    log("Database fix completed successfully.");
  } catch (error) {
    log(`Error during database fix: ${error.message}`);
    if (error.stack) log(error.stack);
  } finally {
    db.close(() => {
      log("Database connection closed.");
      process.exit(0);
    });
  }
}

// Run the fix
fixDatabase();
