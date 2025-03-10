const { chromium } = require('playwright');
const { getAsync, runAsync } = require('../db/db');
const { generatePDF, generateCSV } = require('./reportGenerator');
const { crawlAndTest } = require('./scanner');
const logger = require('../utils/logger');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const { PLAYWRIGHT_TIMEOUT, PLAYWRIGHT_ARGS } = require('../config/config');

/**
 * Process the scan queue continuously
 * @returns {Promise<NodeJS.Timeout>} Interval ID for the queue processor
 */
function startQueueProcessor() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('🚦 Queue Processor: Initializing');

      // Internal async function to process queue
      const processQueue = async () => {
        try {
          // Get the next URL from the queue
          const queueItem = await getAsync('SELECT url, COALESCE(max_pages, 1000) AS max_pages FROM queue LIMIT 1');
          
          if (!queueItem) {
            // No URLs in queue
            logger.debug('🔍 No items in queue');
            return;
          }
          
          const { url, max_pages: maxPages } = queueItem;
          const scanId = Date.now().toString();
          
          logger.info(`🔗 Processing queued URL: ${url} with maxPages: ${maxPages} and scan ID: ${scanId}`);
          
          try {
            // Launch browser
            const browser = await chromium.launch({
              headless: true,
              timeout: PLAYWRIGHT_TIMEOUT,
              args: PLAYWRIGHT_ARGS,
            });
            
            // Perform the scan with enhanced progress tracking
            await crawlAndTest(url, browser, maxPages, 1, (pagesScanned, pagesFound, queueSize) => {
              logger.info(`📊 Scan progress for ${scanId}: ${pagesScanned} pages scanned, ${pagesFound} pages found, ${queueSize} pages in queue`);
            }, scanId, 5);
            
            // Close browser
            await browser.close();
            
            // Generate reports
            logger.info(`✅ Scan completed, generating reports for scan ${scanId}`);
            const pdfPath = await generatePDF(scanId, url);
            const csvPath = await generateCSV(scanId, url);
            
            // Update scan results with completion status and report paths
            await runAsync(
              'UPDATE scan_results SET status = ?, report_pdf = ?, report_csv = ? WHERE scan_id = ?',
              ['completed', pdfPath, csvPath, scanId]
            );
            
            logger.info(`📄 Reports generated for scan ${scanId}: PDF: ${pdfPath}, CSV: ${csvPath}`);
            
            // Remove the URL from the queue
            await runAsync('DELETE FROM queue WHERE url = ?', [url]);
            logger.info(`🗑️ Removed URL ${url} from queue after successful processing`);
          } catch (scanError) {
            logger.error(`❌ Scan failed for URL ${url} with scan ID ${scanId}: ${scanError.stack}`);
            
            // Update scan results with error status
            await runAsync(
              'UPDATE scan_results SET status = ? WHERE scan_id = ?',
              ['failed', scanId]
            );
            
            // Remove from queue to prevent blocking the queue
            await runAsync('DELETE FROM queue WHERE url = ?', [url]);
            logger.info(`🚫 Removed URL ${url} from queue after failed processing`);
          }
        } catch (queueError) {
          logger.error(`❌ Error in queue processor: ${queueError.stack}`);
        }
      };

      // Set up interval to process queue
      const intervalId = setInterval(processQueue, 
        parseInt(process.env.QUEUE_CHECK_INTERVAL || '60000', 10) // Default 1 minute
      );

      // Run immediately
      processQueue();

      logger.info('🟢 Queue Processor: Initialized successfully');
      resolve(intervalId);
    } catch (setupError) {
      logger.error(`❌ Queue Processor setup failed: ${setupError.message}`);
      reject(setupError);
    }
  });
}

module.exports = {
  startQueueProcessor
};
