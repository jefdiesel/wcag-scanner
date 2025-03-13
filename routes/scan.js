const express = require('express');
const router = express.Router();
const { runAsync, getAsync, allAsync } = require('../db/db');
const logger = require('../utils/logger');
const { shouldAllowUrl } = require('../utils/urlFilter');
const { getEmailsForScan } = require('../services/reportGenerator');
const { safeJsonParse } = require('../services/reportGenerator');

// Render the scan form 
router.get('/', (req, res) => {
  res.render('scan', {
    title: 'Accessibility Scan',
    active: 'scan'
  });
});

/**
 * Handle scan form submission
 */
router.post('/submit', async (req, res) => {
  try {
    const { url, maxPages, queue } = req.body;
    
    // Validate URL
    if (!url || typeof url !== 'string') {
      if (req.headers['content-type'] === 'application/json') {
        return res.status(400).json({
          error: 'Please provide a valid URL'
        });
      } else {
        return res.status(400).render('error', {
          title: 'Invalid URL',
          message: 'Please provide a valid URL to scan',
          error: { status: 400 }
        });
      }
    }

    // Basic URL format validation
    if (!url.match(/^https?:\/\//i)) {
      if (req.headers['content-type'] === 'application/json') {
        return res.status(400).json({
          error: 'Please ensure your URL starts with http:// or https://'
        });
      } else {
        return res.status(400).render('error', {
          title: 'Invalid URL Format',
          message: 'Please ensure your URL starts with http:// or https://',
          error: { status: 400 }
        });
      }
    }
    
    // Check if URL is allowed by the filter
    if (!shouldAllowUrl(url)) {
      if (req.headers['content-type'] === 'application/json') {
        return res.status(400).json({
          error: 'This URL cannot be scanned. Please ensure it is a valid public website.'
        });
      } else {
        return res.status(400).render('error', {
          title: 'URL Not Allowed',
          message: 'This URL cannot be scanned. Please ensure it is a valid public website.',
          error: { status: 400 }
        });
      }
    }
    
    // Generate a unique scan ID
    const scanId = Date.now().toString();
    
    // Parse and validate max pages
    const pagesToScan = parseInt(maxPages) || 100;
    
    // If queuing is requested, add to queue and return
    if (queue) {
      // Add URL to queue
      await runAsync(
        'INSERT INTO queue (url, max_pages) VALUES (?, ?)',
        [url, pagesToScan]
      );
      
      if (req.headers['content-type'] === 'application/json') {
        return res.json({
          message: 'URL added to queue successfully',
          success: true
        });
      } else {
        return res.redirect('/queue?success=true');
      }
    }

    // For immediate scans, add entry to scan_results
    await runAsync(
      'INSERT INTO scan_results (scan_id, url, status, scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [scanId, url, 'in_progress']
    );
    
    // Add to queue for processing
    await runAsync(
      'INSERT INTO queue (url, max_pages) VALUES (?, ?)',
      [url, pagesToScan]
    );
    
    if (req.headers['content-type'] === 'application/json') {
      return res.json({
        scanId,
        message: 'Scan started successfully'
      });
    } else {
      // If not AJAX, redirect to results waiting page
      return res.redirect(`/scan/results/${scanId}`);
    }
  } catch (error) {
    logger.error(`Error processing scan request: ${error.message}`);
    
    if (req.headers['content-type'] === 'application/json') {
      return res.status(500).json({
        error: 'An error occurred while processing your request'
      });
    } else {
      return res.status(500).render('error', {
        title: 'Server Error',
        message: 'An error occurred while processing your request',
        error: { status: 500 }
      });
    }
  }
});

// SSE for progress updates with enhanced information
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const scanId = req.query.scanId;
  if (!scanId) {
    res.write('data: ' + JSON.stringify({ error: 'No scan ID provided' }) + '\n\n');
    res.end();
    return;
  }

  // Set up interval to check progress
  const checkProgress = setInterval(async () => {
    try {
      // Get count of scanned pages
      const scannedResult = await allAsync(
        'SELECT COUNT(*) as scanned FROM scan_results WHERE scan_id = ?',
        [scanId]
      );
      
      // Get count of found pages (from links column)
      const linksResult = await allAsync(
        'SELECT links FROM scan_results WHERE scan_id = ?',
        [scanId]
      );
      
      // Calculate total unique links found and in queue
      let uniqueUrls = new Set();
      let visitedUrls = new Set();
      
      // Get all URLs that have been visited
      const visitedRowsResult = await allAsync(
        'SELECT url FROM scan_results WHERE scan_id = ?',
        [scanId]
      );
      
      visitedRowsResult.forEach(row => {
        visitedUrls.add(row.url);
      });
      
      // Get all links found during crawling
      linksResult.forEach(row => {
        try {
          const links = JSON.parse(row.links || '[]');
          links.forEach(link => uniqueUrls.add(link));
        } catch (e) {
          // Skip parsing errors
        }
      });
      
      // Calculate links in queue (found but not yet visited)
      const inQueue = Array.from(uniqueUrls).filter(url => !visitedUrls.has(url)).length;
      
      // Get completion status
      const statusResult = await allAsync(
        'SELECT status FROM scan_results WHERE scan_id = ? AND status = ? LIMIT 1',
        [scanId, 'completed']
      );
      
      const scanned = scannedResult[0]?.scanned || 0;
      const found = uniqueUrls.size + visitedUrls.size; // Total unique URLs
      const completed = statusResult.length > 0;
      
      // Send progress data as JSON
      res.write('data: ' + JSON.stringify({
        scanned,
        found,
        inQueue,
        completed
      }) + '\n\n');
      
      // If scan is completed, close the connection
      if (completed) {
        clearInterval(checkProgress);
        res.end();
      }
    } catch (error) {
      logger.error(`Progress check failed for scan ${scanId}: ${error.message}`);
      res.write('data: ' + JSON.stringify({ error: 'Failed to check progress' }) + '\n\n');
      clearInterval(checkProgress);
      res.end();
    }
  }, 1000);

  // Clean up on client disconnect
  req.on('close', () => clearInterval(checkProgress));
});

// Get scan results 
router.get('/results/:scanId', async (req, res) => {
  try {
    const { scanId } = req.params;
    
    // Get scan information
    const scanInfo = await getAsync(
      `SELECT url, status, error_message, scanned_at, report_pdf, report_csv
       FROM scan_results 
       WHERE scan_id = ? 
       ORDER BY scanned_at DESC LIMIT 1`,
      [scanId]
    );
    
    if (!scanInfo) {
      return res.status(404).render('error', {
        title: 'Scan Not Found',
        message: 'The requested scan could not be found',
        error: { status: 404 }
      });
    }
    
    // Get scan results with violations
    const results = await allAsync(
      'SELECT url, violations, links, status FROM scan_results WHERE scan_id = ? ORDER BY scanned_at',
      [scanId]
    );
    
    // Get emails for this scan
    const emails = await getEmailsForScan(scanId);
    
    // Get total pages scanned and found statistics
    const totalPagesScanned = results.length;
    let allFoundUrls = new Set();
    
    results.forEach(row => {
      allFoundUrls.add(row.url);
      const links = safeJsonParse(row.links, []);
      links.forEach(link => {
        if (link && typeof link === 'string') {
          allFoundUrls.add(link);
        }
      });
    });
    
    const totalPagesFound = allFoundUrls.size;
    
    // Render the scan results page
    res.render('scan_results', {
      title: 'Scan Results',
      scan: scanInfo,
      results: results,
      scanId,
      stats: {
        totalPagesScanned,
        totalPagesFound,
        totalEmails: emails.length
      },
      emails: emails.slice(0, 50), // Show first 50 emails max on the page
      active: 'scan'
    });
    
  } catch (error) {
    logger.error(`Error retrieving scan results: ${error.message}`);
    
    return res.status(500).render('error', {
      title: 'Server Error',
      message: 'An error occurred while retrieving scan results',
      error: { status: 500 }
    });
  }
});

module.exports = router;
