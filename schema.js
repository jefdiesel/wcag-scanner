 // schema-checker.js - Just check the database schema
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Get database path from environment variables or use default
const dbPath = process.env.DATABASE_PATH || './data/wcag_scanner.db';
const fullDbPath = path.resolve(dbPath);

console.log(`Attempting to open database at: ${fullDbPath}`);

// Try to open the database with a timeout
const timeout = setTimeout(() => {
  console.log("Timeout waiting for database open. It might be locked.");
  process.exit(1);
}, 5000);

// Open database with no special flags to just check if we can access it
const db = new sqlite3.Database(fullDbPath, sqlite3.OPEN_READONLY, (err) => {
  clearTimeout(timeout);
  if (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }
  console.log("Successfully opened database in read-only mode.");
});

// Get all table names
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
  if (err) {
    console.error(`Error getting tables: ${err.message}`);
    db.close();
    return;
  }
  
  console.log("\nDatabase tables:");
  tables.forEach(table => {
    console.log(`- ${table.name}`);
  });
  
  // For each table, get its schema
  let tablesProcessed = 0;
  tables.forEach(table => {
    db.all(`PRAGMA table_info(${table.name})`, [], (err, columns) => {
      if (err) {
        console.error(`Error getting schema for ${table.name}: ${err.message}`);
      } else {
        console.log(`\nSchema for ${table.name}:`);
        columns.forEach(col => {
          console.log(`- ${col.name} (${col.type})${col.pk ? ' PRIMARY KEY' : ''}`);
        });
      }
      
      tablesProcessed++;
      if (tablesProcessed === tables.length) {
        console.log("\nSchema check complete.");
        db.close();
      }
    });
  });
});
