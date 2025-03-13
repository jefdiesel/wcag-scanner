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
