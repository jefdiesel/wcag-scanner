-- save this as cleanup.sql
-- Run it with: sqlite3 ./data/wcag_scanner.db < cleanup.sql

-- 1. Add processing_error column if it doesn't exist
ALTER TABLE scan_email_requests ADD COLUMN processing_error TEXT DEFAULT NULL;

-- 2. Find duplicates in scan_results
SELECT scan_id, COUNT(*) as count
FROM scan_results 
WHERE url LIKE '%thisiscolossal.com%' 
GROUP BY scan_id
HAVING COUNT(*) > 1;

-- 3. Delete duplicates keeping only one entry per scan_id
-- First create a temporary table with the rows to keep
CREATE TEMPORARY TABLE scan_results_keep AS
SELECT scan_id, MAX(rowid) as rowid_to_keep
FROM scan_results
GROUP BY scan_id;

-- Then delete all rows except the ones we want to keep
DELETE FROM scan_results
WHERE rowid NOT IN (SELECT rowid_to_keep FROM scan_results_keep);

-- 4. Mark all completed scans as sent in email requests
UPDATE scan_email_requests
SET report_sent = 1, 
    report_sent_at = CURRENT_TIMESTAMP
WHERE scan_id IN (
    SELECT scan_id FROM scan_results WHERE status = 'completed'
) AND report_sent = 0;

-- 5. Remove any completed URLs from the queue (if they exist)
DELETE FROM queue
WHERE url IN (
    SELECT url FROM scan_results WHERE status = 'completed'
);

-- 6. Create indexes
CREATE INDEX IF NOT EXISTS idx_scan_results_url ON scan_results(url);
CREATE INDEX IF NOT EXISTS idx_scan_results_scanid ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_email_url ON scan_email_requests(url);
CREATE INDEX IF NOT EXISTS idx_scan_email_scanid ON scan_email_requests(scan_id);

-- 7. Show counts
SELECT 'scan_results rows' as table_name, COUNT(*) as count FROM scan_results
UNION ALL
SELECT 'scan_email_requests rows', COUNT(*) FROM scan_email_requests
UNION ALL
SELECT 'completed scans', COUNT(*) FROM scan_results WHERE status = 'completed';
