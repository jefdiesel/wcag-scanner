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

// Process scan form submission
router.post('/submit', async (req, res) => {
  try {
    const { url, scanType, maxPages } = req.body;
    
    // Validate URL
    if (!url || typeof url !== 'string') {
      return res.status(400).render('error', {
        title: 'Invalid URL',
        message: 'Please provide a valid URL to scan',
        error: { status: 400 }
      });
    }
    
    // Basic URL format validation
    if (!url.match(/^https?:\/\//i)) {
      return res.status(400).render('error', {
        title: 'Invalid URL Format',
        message: 'Please ensure your URL starts with http:// or https://',
        error: { status: 400 }
      });
    }
    
    // Check if URL is allowed by the filter
    if (!shouldAllowUrl(url)) {
      return res.status(400).render('error', {
        title: 'URL Not Allowed',
        message: 'This URL cannot be scanned. Please ensure it is a valid public website.',
        error: { status: 400 }
      });
    }
    
    // Determine max pages based on scan type
    let pagesToScan = 100; // Default for standard scan
    
    if (scanType === 'deep') {
      // Parse and validate max pages for deep scan
      const parsedMaxPages = parseInt(maxPages, 10);
      if (!isNaN(parsedMaxPages) && parsedMaxPages >= 100 && parsedMaxPages <= 1000) {
        pagesToScan = parsedMaxPages;
      } else {
        return res.status(400).render('error', {
          title: 'Invalid Configuration',
          message: 'Please specify a valid number of pages between 100 and 1000 for a deep scan',
          error: { status: 400 }
        });
      }
    }
    
    // Add the URL to the scan queue with the specified max pages
    await runAsync('INSERT INTO queue (url, max_pages, added_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 
      [url, pagesToScan]
    );
    
    // Redirect to the queue page
    return res.redirect('/queue?message=Scan+added+to+queue&scan_type=' + 
      (scanType === 'deep' ? 'deep' : 'standard') + 
      '&max_pages=' + pagesToScan);
    
  } catch (error) {
    logger.error(`Error processing scan request: ${error.message}`);
    
    return res.status(500).render('error', {
      title: 'Server Error',
      message: 'An error occurred while processing your request',
      error: { status: 500 }
    });
  }
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
