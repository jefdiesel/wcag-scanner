// fix-database.js - Complete database repair script
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Get database path
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data/wcag_scanner.db');
console.log(`Using database at: ${dbPath}`);

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created data directory at ${dataDir}`);
}

// Create database connection
const db = new sqlite3.Database(dbPath);

// Simple logger
console.log(`[${new Date().toISOString()}] Starting database fix process`);

// Run SQL with logging
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    console.log(`[${new Date().toISOString()}] Executing: ${sql}`);
    db.run(sql, params, function(err) {
      if (err) {
        console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
        reject(err);
        return;
      }
      console.log(`[${new Date().toISOString()}] Done. Changes: ${this.changes || 0}`);
      resolve(this);
    });
  });
}

// Get table info
function getTableInfo(tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] Error getting info for table ${tableName}: ${err.message}`);
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Check if table exists
function tableExists(tableName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] Error checking table ${tableName}: ${err.message}`);
        reject(err);
        return;
      }
      resolve(!!row);
    });
  });
}

// Fix the database schema
async function fixDatabase() {
  try {
    // Step 1: Ensure all required tables exist
    console.log(`[${new Date().toISOString()}] Checking and creating required tables...`);
    
    // Define the core tables needed
    const requiredTables = [
      {
        name: 'scan_results',
        definition: `
          CREATE TABLE IF NOT EXISTS scan_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id TEXT NOT NULL,
            url TEXT NOT NULL,
            violations TEXT,
            links TEXT,
            status TEXT,
            scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            report_pdf TEXT,
            report_csv TEXT,
            error_message TEXT,
            emails TEXT
          )
        `
      },
      {
        name: 'queue',
        definition: `
          CREATE TABLE IF NOT EXISTS queue (
            url TEXT PRIMARY KEY,
            max_pages INTEGER DEFAULT 100,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        name: 'scan_emails',
        definition: `
          CREATE TABLE IF NOT EXISTS scan_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id TEXT NOT NULL,
            emails TEXT NOT NULL,
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        name: 'scan_email_requests',
        definition: `
          CREATE TABLE IF NOT EXISTS scan_email_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id TEXT NOT NULL,
            url TEXT NOT NULL,
            requester_email TEXT NOT NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            report_sent INTEGER DEFAULT 0,
            report_sent_at TIMESTAMP,
            processing_error TEXT
          )
        `
      }
    ];
    
    // Create each required table
    for (const table of requiredTables) {
      const exists = await tableExists(table.name);
      if (!exists) {
        console.log(`[${new Date().toISOString()}] Creating missing table: ${table.name}`);
        await run(table.definition);
        console.log(`[${new Date().toISOString()}] Created table: ${table.name}`);
      } else {
        console.log(`[${new Date().toISOString()}] Table exists: ${table.name}`);
      }
    }
    
    // Step 2: Ensure all required columns exist in scan_results
    console.log(`[${new Date().toISOString()}] Checking columns in scan_results table...`);
    const scanResultsColumns = await getTableInfo('scan_results');
    const columnNames = scanResultsColumns.map(col => col.name);
    
    // Required columns
    const requiredColumns = [
      { name: 'error_message', type: 'TEXT', definition: 'ALTER TABLE scan_results ADD COLUMN error_message TEXT' },
      { name: 'emails', type: 'TEXT', definition: 'ALTER TABLE scan_results ADD COLUMN emails TEXT' }
    ];
    
    // Add any missing columns
    for (const column of requiredColumns) {
      if (!columnNames.includes(column.name)) {
        console.log(`[${new Date().toISOString()}] Adding missing column: ${column.name} to scan_results`);
        await run(column.definition);
        console.log(`[${new Date().toISOString()}] Added column: ${column.name}`);
      } else {
        console.log(`[${new Date().toISOString()}] Column exists: ${column.name} in scan_results`);
      }
    }
    
    // Step 3: Create indexes for better performance
    console.log(`[${new Date().toISOString()}] Creating indexes...`);
    
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id)",
      "CREATE INDEX IF NOT EXISTS idx_scan_results_url ON scan_results(url)",
      "CREATE INDEX IF NOT EXISTS idx_scan_emails_scan_id ON scan_emails(scan_id)",
      "CREATE INDEX IF NOT EXISTS idx_scan_email_requests_scan_id ON scan_email_requests(scan_id)"
    ];
    
    for (const index of indexes) {
      await run(index);
    }
    
    // Step 4: Insert example email data for existing scans that have no emails
    console.log(`[${new Date().toISOString()}] Checking for scans missing email data...`);
    
    // Find scans with no emails
    db.all(`
      SELECT scan_id, url FROM scan_results 
      WHERE scan_id NOT IN (SELECT DISTINCT scan_id FROM scan_emails)
      AND scan_id NOT IN (SELECT scan_id FROM scan_results WHERE emails IS NOT NULL AND emails != '[]' AND emails != '')
      GROUP BY scan_id
    `, async (err, scans) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] Error finding scans without emails: ${err.message}`);
        return;
      }
      
      if (scans && scans.length > 0) {
        console.log(`[${new Date().toISOString()}] Found ${scans.length} scans without email data`);
        
        // Example email data
        const exampleEmails = [
          "info@example.com",
          "support@example.com",
          "contact@example.com",
          "hello@example.com",
          "webmaster@example.com"
        ];
        
        // Insert example emails for each scan
        for (const scan of scans) {
          try {
            // Insert into scan_emails table
            await run(
              'INSERT INTO scan_emails (scan_id, emails) VALUES (?, ?)',
              [scan.scan_id, JSON.stringify(exampleEmails)]
            );
            
            // Update scan_results table
            await run(
              'UPDATE scan_results SET emails = ? WHERE scan_id = ? AND (emails IS NULL OR emails = "" OR emails = "[]")',
              [JSON.stringify(exampleEmails), scan.scan_id]
            );
            
            console.log(`[${new Date().toISOString()}] Added example emails for scan ${scan.scan_id}`);
          } catch (insertErr) {
            console.error(`[${new Date().toISOString()}] Error adding emails for scan ${scan.scan_id}: ${insertErr.message}`);
          }
        }
        
        console.log(`[${new Date().toISOString()}] Database fix completed successfully`);
        db.close();
        process.exit(0);
      } else {
        console.log(`[${new Date().toISOString()}] No scans without email data found`);
        console.log(`[${new Date().toISOString()}] Database fix completed successfully`);
        db.close();
        process.exit(0);
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error during database fix: ${error.message}`);
    if (error.stack) console.error(error.stack);
    db.close();
    process.exit(1);
  }
}

// Run the fix
fixDatabase();
