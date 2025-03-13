// db/migrations/runner.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Define the database path directly in this file
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

console.log(`Using database at: ${DB_PATH}`);

// Create a database connection
const db = new sqlite3.Database(DB_PATH);

// Initial schema to create tables if they don't exist
const initialSchema = `
-- Create scan_results table if it doesn't exist
CREATE TABLE IF NOT EXISTS scan_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  violations TEXT,
  links TEXT,
  report_pdf TEXT,
  report_csv TEXT,
  error_message TEXT,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create queue table if it doesn't exist
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// Migration to add email support
const emailMigration = `
-- Add emails column to scan_results table if it doesn't exist
ALTER TABLE scan_results ADD COLUMN emails TEXT DEFAULT NULL;

-- Create a new table to store all collected emails for a scan
CREATE TABLE IF NOT EXISTS scan_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  emails TEXT NOT NULL, -- JSON array of emails
  found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scan_id) REFERENCES scan_results(scan_id)
);

-- Create index for scan_id in scan_emails
CREATE INDEX IF NOT EXISTS idx_scan_emails_scan_id ON scan_emails(scan_id);

-- Add max_pages column to queue table if it doesn't exist already
ALTER TABLE queue ADD COLUMN max_pages INTEGER DEFAULT 100;
`;

console.log('Creating base schema if needed...');

// Run initial schema first
db.exec(initialSchema, (err) => {
  if (err) {
    console.error('Error creating initial schema:', err.message);
    db.close();
    return;
  }

  console.log('Initial schema created or already exists.');
  console.log('Running email migration...');

  // Then run email migration
  db.exec(emailMigration, (err) => {
    if (err) {
      console.error('Email migration error:', err.message);
    } else {
      console.log('Email migration completed successfully');
    }
    
    // Close the database connection
    db.close();
  });
});
