const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { allAsync, runAsync } = require('../db/db');
const logger = require('../utils/logger');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const { REPORT_DIR } = require('../config/config');
const { DEFAULT_MAX_PAGES } = require('../config/config');

// Get queue page
router.get('/', async (req, res) => {
  try {
    // Get queued URLs with their maxPages
    const queuedUrls = await allAsync('SELECT url, COALESCE(max_pages, ?) AS max_pages FROM queue', [DEFAULT_MAX_PAGES]);
    
    // Get completed scans with their report links
    const completedScans = await allAsync(
      'SELECT DISTINCT scan_id, url, status, report_pdf, report_csv FROM scan_results WHERE status = ? GROUP BY scan_id ORDER BY scanned_at DESC LIMIT 20',
      ['completed']
    );
    
    // Format completed scans data for template
    const formattedScans = completedScans.map(row => {
      const sanitizedUrl = row.url.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_').toLowerCase();
      
      return {
        scanId: row.scan_id,
        url: row.url,
        status: row.status,
        pdfUrl: row.report_pdf ? `/reports/${sanitizedUrl}/${row.report_pdf.split('/').pop()}` : null,
        csvUrl: row.report_csv ? `/reports/${sanitizedUrl}/${row.report_csv.split('/').pop()}` : null
      };
    });
    
    res.render('queue', { queuedUrls, completedScans: formattedScans, success: req.query.success === 'true' });
  } catch (error) {
    logger.error(`Error loading queue page: ${error.stack}`);
    res.status(500).send(`Error loading queue data: ${error.message}`);
  }
});

// API endpoint to get queue data
router.get('/data', async (req, res) => {
  try {
    // Get queued URLs with their maxPages
    const queuedUrls = await allAsync('SELECT url, COALESCE(max_pages, ?) AS max_pages FROM queue', [DEFAULT_MAX_PAGES]);
    
    res.json({ queuedUrls });
  } catch (error) {
    logger.error(`Error getting queue data: ${error.stack}`);
    res.status(500).json({ error: error.message });
  }
});

// Handle adding URLs to the queue
router.post('/add', async (req, res) => {
  const { url, maxPages } = req.body;
  
  // Trim and check URL
  const trimmedUrl = url ? url.trim() : '';
  const pagesToScan = parseInt(maxPages) || DEFAULT_MAX_PAGES;
  
  if (!trimmedUrl) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  try {
    // Add URL to the queue with maxPages
    await runAsync(
      'INSERT OR REPLACE INTO queue (url, max_pages) VALUES (?, ?)', 
      [trimmedUrl, pagesToScan]
    );
    
    logger.info(`URL ${trimmedUrl} with maxPages ${pagesToScan} added to scanning queue`);
    
    // Redirect back to the queue page with success message
    if (req.headers['content-type'] === 'application/json') {
      res.json({ message: 'URL added to queue successfully' });
    } else {
      res.redirect('/queue?success=true');
    }
  } catch (error) {
    logger.error(`Failed to add URL ${trimmedUrl} to queue: ${error.stack}`);
    
    if (req.headers['content-type'] === 'application/json') {
      res.status(500).json({ error: 'Failed to add URL to queue' });
    } else {
      res.status(500).send('Failed to add URL to queue');
    }
  }
});

// Handle removing URLs from the queue
router.post('/remove', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  try {
    // Remove URL from the queue
    await runAsync('DELETE FROM queue WHERE url = ?', [url]);
    logger.info(`URL ${url} removed from scanning queue`);
    res.json({ message: 'URL removed successfully' });
  } catch (error) {
    logger.error(`Failed to remove URL ${url} from queue: ${error.stack}`);
    res.status(500).json({ error: 'Failed to remove URL from queue' });
  }
});

// Add this route to your existing routes/queue.js file

// Delete scan results
router.post('/delete-scan', async (req, res) => {
  const { scanId } = req.body;
  
  if (!scanId) {
    return res.status(400).json({ error: 'Scan ID is required' });
  }
  
  try {
    // Get the URL of the scan first (for deleting report files)
    const scanRow = await allAsync(
      'SELECT url FROM scan_results WHERE scan_id = ? LIMIT 1',
      [scanId]
    );
    
    if (scanRow.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    const url = scanRow[0].url;
    const sanitizedUrl = sanitizeUrlForFilename(url);
    
    // Delete report files if they exist
    const reportDir = path.join(REPORT_DIR, sanitizedUrl);
    if (fs.existsSync(reportDir)) {
      fs.rmdirSync(reportDir, { recursive: true });
      logger.info(`Deleted report directory for ${url}`);
    }
    
    // Delete scan results from database
    await runAsync('DELETE FROM scan_results WHERE scan_id = ?', [scanId]);
    logger.info(`Deleted scan results for scan ID ${scanId}`);
    
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete scan results for scan ID ${scanId}: ${error.stack}`);
    res.status(500).json({ error: 'Failed to delete scan results' });
  }
});

module.exports = router;
