const { chromium } = require('playwright');
const { getAsync, runAsync } = require('../db/db');
const { generatePDF, generateCSV } = require('./reportGenerator');
const { crawlAndTest } = require('./scanner');
const logger = require('../utils/logger');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const { PLAYWRIGHT_TIMEOUT, PLAYWRIGHT_ARGS } = require('../config/config');

/**
 * Process the scan queue continuously
 */
async function startQueueProcessor() {
  logger.info('Starting scan queue processor');
  
  while (true) {
    try {
      // Get the next URL from the queue
      const queueItem = await getAsync('SELECT url, COALESCE(max_pages, 1000) AS max_pages FROM queue LIMIT 1');
      
      if (!queueItem) {
        // No URLs in queue, wait before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      const { url, max_pages: maxPages } = queueItem;
      const scanId = Date.now().toString();
      
      logger.info(`Processing queued URL: ${url} with maxPages: ${maxPages} and scan ID: ${scanId}`);
      
      try {
        // Launch browser
        const browser = await chromium.launch({
          headless: true,
          timeout: PLAYWRIGHT_TIMEOUT,
          args: PLAYWRIGHT_ARGS,
        });
        
        // Perform the scan
        await crawlAndTest(url, browser, maxPages, 1, (progress) => {
          logger.info(`Scan progress for ${scanId}: ${progress} pages scanned`);
        }, scanId, 5);
        
        // Close browser
        await browser.close();
        
        // Generate reports
        logger.info(`Scan completed, generating reports for scan ${scanId}`);
        const pdfPath = await generatePDF(scanId, url);
        const csvPath = await generateCSV(scanId, url);
        
        // Update scan results with completion status and report paths
        await runAsync(
          'UPDATE scan_results SET status = ?, report_pdf = ?, report_csv = ? WHERE scan_id = ?',
          ['completed', pdfPath, csvPath, scanId]
        );
        
        logger.info(`Reports generated for scan ${scanId}: PDF: ${pdfPath}, CSV: ${csvPath}`);
        
        // Remove the URL from the queue
        await runAsync('DELETE FROM queue WHERE url = ?', [url]);
        logger.info(`Removed URL ${url} from queue after successful processing`);
      } catch (scanError) {
        logger.error(`Scan failed for URL ${url} with scan ID ${scanId}: ${scanError.stack}`);
        
        // Update scan results with error status
        await runAsync(
          'UPDATE scan_results SET status = ? WHERE scan_id = ?',
          ['failed', scanId]
        );
        
        // Remove from queue to prevent blocking the queue
        await runAsync('DELETE FROM queue WHERE url = ?', [url]);
        logger.info(`Removed URL ${url} from queue after failed processing`);
      }
    } catch (queueError) {
      logger.error(`Error in queue processor: ${queueError.stack}`);
      // Wait a bit before trying again to avoid spinning too fast on persistent errors
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

module.exports = {
  startQueueProcessor
};
