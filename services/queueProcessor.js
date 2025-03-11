const { chromium } = require('playwright');
const { getAsync, allAsync, runAsync } = require('../db/db');
const { generatePDF, generateCSV } = require('./reportGenerator');
const { crawlAndTest } = require('./scanner');
const logger = require('../utils/logger');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const { PLAYWRIGHT_TIMEOUT, PLAYWRIGHT_ARGS } = require('../config/config');
const { URL } = require('url');

// Track problematic URLs to avoid repeated attempts
const problematicUrls = new Map();
// Track active scans by domain to prevent multiple scans of the same domain
const activeDomains = new Map();
// Configure maximum concurrent scans overall and per domain
const MAX_CONCURRENT_SCANS = parseInt(process.env.SCANNER_MAX_CONCURRENT || '2', 10);
const MAX_ATTEMPTS = parseInt(process.env.SCANNER_MAX_ATTEMPTS || '3', 10);
const BROWSER_TIMEOUT = parseInt(process.env.SCANNER_TIMEOUT || '45000', 10);

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain name
 */
function extractDomain(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    logger.error(`Error extracting domain from ${url}: ${error.message}`);
    return url; // Fallback to using the whole URL as the "domain"
  }
}

/**
 * Check if we can start another scan based on concurrency limits
 * @returns {boolean} True if we can start another scan
 */
function canStartNewScan() {
  return activeDomains.size < MAX_CONCURRENT_SCANS;
}

/**
 * Check if domain is already being scanned
 * @param {string} domain - Domain to check
 * @returns {boolean} True if domain is already being scanned
 */
function isDomainActive(domain) {
  return activeDomains.has(domain);
}

/**
 * Register a domain as active
 * @param {string} domain - Domain to register
 * @param {string} scanId - Scan ID
 */
function registerActiveDomain(domain, scanId) {
  activeDomains.set(domain, scanId);
  logger.info(`🔒 Domain ${domain} is now being scanned with scan ID ${scanId}`);
}

/**
 * Unregister a domain
 * @param {string} domain - Domain to unregister
 */
function unregisterActiveDomain(domain) {
  if (activeDomains.has(domain)) {
    logger.info(`🔓 Domain ${domain} scan completed and released from active scans`);
    activeDomains.delete(domain);
  }
}

/**
 * Process the scan queue continuously
 * @returns {Promise<NodeJS.Timeout>} Interval ID for the queue processor
 */
function startQueueProcessor() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('🚦 Queue Processor: Initializing');
      logger.info(`🔢 Maximum concurrent scans: ${MAX_CONCURRENT_SCANS}`);

      // Internal async function to process queue
      const processQueue = async () => {
        try {
          // Check if we've reached the maximum number of concurrent scans
          if (!canStartNewScan()) {
            logger.debug(`👋 Maximum concurrent scans (${MAX_CONCURRENT_SCANS}) reached. Waiting...`);
            logger.debug(`🔍 Active domains: ${Array.from(activeDomains.keys()).join(', ')}`);
            return;
          }
          
          // Get the next URL from the queue
          const queueItems = await allAsync(`
            SELECT url, COALESCE(max_pages, 100) AS max_pages 
            FROM queue 
            ORDER BY url ASC
            LIMIT 20
          `);
          
          if (!queueItems || queueItems.length === 0) {
            // No URLs in queue
            logger.debug('🔍 No items in queue');
            return;
          }
          
          // Find the first URL that isn't from a domain we're already scanning
          let selectedItem = null;
          for (const item of queueItems) {
            const domain = extractDomain(item.url);
            if (!isDomainActive(domain)) {
              selectedItem = item;
              break;
            }
          }
          
          // If all URLs in our batch are from domains already being scanned, skip
          if (!selectedItem) {
            logger.debug('🔍 All queued URLs are from domains already being scanned');
            return;
          }
          
          const { url, max_pages: maxPages } = selectedItem;
          const domain = extractDomain(url);
          const scanId = Date.now().toString();
          
          // Register this domain as active
          registerActiveDomain(domain, scanId);
          
          // Check if URL is problematic
          if (problematicUrls.has(url)) {
            const attempts = problematicUrls.get(url);
            if (attempts >= MAX_ATTEMPTS) {
              logger.warn(`🚫 URL ${url} has failed ${attempts} times. Removing from queue.`);
              await runAsync('DELETE FROM queue WHERE url = ?', [url]);
              logger.info(`🚫 Removed URL ${url} from queue after failed processing`);
              
              // Mark scan as failed in results
              await runAsync(
                'INSERT OR IGNORE INTO scan_results (scan_id, url, status, scanned_at, error_message) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)',
                [scanId, url, 'failed', `Failed after ${attempts} attempts. URL may be inaccessible or require authentication.`]
              );
              
              // Unregister domain
              unregisterActiveDomain(domain);
              return;
            }
            
            logger.warn(`⚠️ URL ${url} has failed ${attempts} times. Retrying...`);
            problematicUrls.set(url, attempts + 1);
          }
          
          logger.info(`🔗 Processing queued URL: ${url} with maxPages: ${maxPages} and scan ID: ${scanId}`);
          
          // Set up a timeout for browser launch
          let timeoutId;
          const launchPromise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`browserType.launch: Timeout ${BROWSER_TIMEOUT}ms exceeded.`));
            }, BROWSER_TIMEOUT);
          });
          
          try {
            // Insert scan record
            await runAsync(
              'INSERT INTO scan_results (scan_id, url, status, scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
              [scanId, url, 'in_progress']
            );
            
            // Launch browser with race against timeout
            const browser = await Promise.race([
              chromium.launch({
                headless: true,
                timeout: BROWSER_TIMEOUT,
                args: PLAYWRIGHT_ARGS,
              }),
              launchPromise
            ]);
            
            // Clear the timeout since browser launched successfully
            clearTimeout(timeoutId);
            
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
            
            // Remove the URL from the queue - note we use url as the key
            await runAsync('DELETE FROM queue WHERE url = ?', [url]);
            logger.info(`🗑️ Removed URL ${url} from queue after successful processing`);
            
            // Reset problematic status if it was previously marked
            if (problematicUrls.has(url)) {
              problematicUrls.delete(url);
            }
          } catch (scanError) {
            // Clear timeout if it's still active
            if (timeoutId) clearTimeout(timeoutId);
            
            logger.error(`❌ Scan failed for URL ${url} with scan ID ${scanId}: ${scanError.message}`);
            
            // Track this problematic URL
            const attempts = problematicUrls.has(url) ? problematicUrls.get(url) + 1 : 1;
            problematicUrls.set(url, attempts);
            
            // Update scan results with error status
            await runAsync(
              'UPDATE scan_results SET status = ?, error_message = ? WHERE scan_id = ?',
              ['failed', scanError.message, scanId]
            );
            
            // Remove from queue only if max attempts reached
            if (attempts >= MAX_ATTEMPTS) {
              await runAsync('DELETE FROM queue WHERE url = ?', [url]);
              logger.info(`🚫 Removed URL ${url} from queue after ${attempts} failed attempts`);
            }
          } finally {
            // Always unregister domain when scan completes or fails
            unregisterActiveDomain(domain);
          }
        } catch (queueError) {
          logger.error(`❌ Error in queue processor: ${queueError.message}`);
          if (queueError.stack) logger.error(`Stack trace: ${queueError.stack}`);
        }
      };

      // Cleanup function to check for stale active domains
      const cleanupActiveDomains = async () => {
        try {
          if (activeDomains.size === 0) return;
          
          logger.debug(`🧹 Checking for stale active domains among ${activeDomains.size} tracked domains`);
          
          // Get all in-progress scans from the database
          const activeScans = await allAsync(`
            SELECT scan_id, url 
            FROM scan_results 
            WHERE status = 'in_progress'
          `);
          
          const activeIds = new Set(activeScans.map(scan => scan.scan_id));
          
          // Check each active domain
          for (const [domain, scanId] of activeDomains.entries()) {
            if (!activeIds.has(scanId)) {
              logger.warn(`🧹 Scan ID ${scanId} for domain ${domain} is no longer active. Cleaning up.`);
              unregisterActiveDomain(domain);
            }
          }
        } catch (error) {
          logger.error(`❌ Error in cleanup function: ${error.message}`);
        }
      };

      // Use a more reasonable interval - not too frequent to cause overload
      const intervalId = setInterval(() => {
        processQueue().catch(error => 
          logger.error(`❌ Unhandled error in queue processor: ${error.message}`)
        );
      }, parseInt(process.env.QUEUE_CHECK_INTERVAL || '15000', 10)); // Default 15 seconds
      
      // Cleanup interval - runs every 2 minutes
      const cleanupId = setInterval(cleanupActiveDomains, 120000);

      // Run immediately
      processQueue().catch(error => 
        logger.error(`❌ Initial queue processing error: ${error.message}`)
      );

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
