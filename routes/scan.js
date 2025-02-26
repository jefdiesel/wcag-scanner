const express = require('express');
const router = express.Router();
const { chromium } = require('playwright');
const { runAsync } = require('../db/db');
const { crawlAndTest } = require('../services/scanner');
const { generatePDF, generateCSV } = require('../services/reportGenerator');
const { sanitizeUrlForFilename, generateScanId } = require('../utils/helpers');
const logger = require('../utils/logger');
const { PLAYWRIGHT_TIMEOUT, PLAYWRIGHT_ARGS, DEFAULT_MAX_PAGES } = require('../config/config');

// Handle WCAG test submission (single URL or queue multiple URLs)
router.post('/test', async (req, res) => {
  const { url, maxPages = DEFAULT_MAX_PAGES, queue = false } = req.body;
  const pagesToScan = parseInt(maxPages) || DEFAULT_MAX_PAGES; // Default if not provided or invalid

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    if (queue) {
      // Add URL to the scanning queue with maxPages
      await runAsync(
        'INSERT OR REPLACE INTO queue (url, max_pages) VALUES (?, ?)', 
        [url, pagesToScan]
      );
      
      logger.info(`URL ${url} with maxPages ${pagesToScan} added to scanning queue`);
      return res.json({ message: 'URL queued for scanning', scanId: null });
    } else {
      // Process single URL immediately
      logger.info(`Starting scan for URL: ${url} with maxPages: ${pagesToScan}`);
      
      const browser = await chromium.launch({
        headless: true,
        timeout: PLAYWRIGHT_TIMEOUT,
        args: PLAYWRIGHT_ARGS,
      });
      
      const scanId = generateScanId();
      
      // Start crawling and testing in the background
      crawlAndTest(url, browser, pagesToScan, 1, (progress) => {
        logger.info(`Scan progress for ${scanId}: ${progress} pages scanned`);
      }, scanId, 5).then(async () => {
        // Close browser after scanning
        await browser.close();
        
        // Auto-generate PDF and CSV reports
        logger.info(`Scan completed, generating reports for scan ${scanId}`);
        const pdfPath = await generatePDF(scanId, url);
        const csvPath = await generateCSV(scanId, url);
        
        // Update scan_results with completion status and report paths
        await runAsync(
          'UPDATE scan_results SET status = ?, report_pdf = ?, report_csv = ? WHERE scan_id = ?',
          ['completed', pdfPath, csvPath, scanId]
        );
        
        logger.info(`Reports generated for scan ${scanId}`);
      }).catch(async (error) => {
        logger.error(`Scan failed: ${error.stack}`);
        
        // Update scan_results with error status
        await runAsync(
          'UPDATE scan_results SET status = ? WHERE scan_id = ?',
          ['failed', scanId]
        );
        
        try {
          await browser.close();
        } catch (e) {
          // Ignore browser close errors
        }
      });
      
      // Return scan ID immediately so client can monitor progress
      const sanitizedUrl = sanitizeUrlForFilename(url);
      res.json({ 
        scanId, 
        message: 'Scan started successfully', 
        resultsUrl: `/results/${scanId}`
      });
    }
  } catch (error) {
    logger.error(`Error handling scan request: ${error.stack}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
