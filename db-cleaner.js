// simplified-db-cleaner.js - More efficient database cleanup script
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Get database path from environment variables or use default
const dbPath = process.env.DATABASE_PATH || './data/wcag_scanner.db';
const fullDbPath = path.resolve(dbPath);

// Check if database file exists
if (!fs.existsSync(fullDbPath)) {
  console.error(`Database file not found at: ${fullDbPath}`);
  process.exit(1);
}

console.log(`Using database at: ${fullDbPath}`);
const db = new sqlite3.Database(fullDbPath);

// Execute SQL with logging
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${sql.split('\n')[0]}...`);
    db.run(sql, params, function(err) {
      if (err) {
        console.error(`Error: ${err.message}`);
        reject(err);
        return;
      }
      console.log(`Done. Changes: ${this.changes}`);
      resolve(this);
    });
  });
}

// Execute a series of operations
async function fixDatabase() {
  try {
    // Step 1: Add processing_error column (will fail silently if it exists)
    console.log("Step 1: Adding processing_error column to scan_email_requests table...");
    try {
      await run('ALTER TABLE scan_email_requests ADD COLUMN processing_error TEXT DEFAULT NULL');
      console.log("Column added successfully.");
    } catch (err) {
      console.log("Column may already exist, continuing...");
    }

    // Step 2: Fix immediate duplicate issue for the URL you mentioned
    console.log("Step 2: Fixing specific URL duplicates in scan_results...");
    await run(`
      DELETE FROM scan_results 
      WHERE id NOT IN (
        SELECT MAX(id) FROM scan_results 
        WHERE url LIKE '%thisiscolossal.com%' 
        GROUP BY scan_id
      )
      AND url LIKE '%thisiscolossal.com%'
    `);

    // Step 3: Mark all completed scans as sent in email requests
    console.log("Step 3: Marking completed scan email requests as processed...");
    await run(`
      UPDATE scan_email_requests
      SET report_sent = 1, 
          report_sent_at = CURRENT_TIMESTAMP
      WHERE scan_id IN (
          SELECT scan_id FROM scan_results WHERE status = 'completed'
      ) AND report_sent = 0
    `);

    // Step 4: Create indexes for performance
    console.log("Step 4: Creating necessary indexes...");
    await run('CREATE INDEX IF NOT EXISTS idx_scan_results_url ON scan_results(url)');
    await run('CREATE INDEX IF NOT EXISTS idx_scan_email_url ON scan_email_requests(url)');

    console.log("Database cleanup completed successfully.");
  } catch (error) {
    console.error("Error during database cleanup:", error);
  } finally {
    db.close();
    console.log("Database connection closed.");
  }
}

// Run the cleanup function
fixDatabase();
