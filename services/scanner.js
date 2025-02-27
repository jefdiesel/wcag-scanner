const fs = require('fs');
const path = require('path');
const { runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Import all analyzers
const { analyzePdf } = require('./analyzers/pdfAnalyzer');
const { analyzeMediaContent } = require('./analyzers/mediaAnalyzer');
const { analyzeKeyboardNavigation } = require('./analyzers/keyboardAnalyzer');
const { identifyManualReviewItems } = require('./analyzers/manualReviewAnalyzer');
const { checkAccessibilityStatement } = require('./analyzers/accessibilityStatementAnalyzer');

/**
 * Performs WCAG accessibility testing on a page
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL to test
 * @returns {Promise<Object>} - Test results
 */
async function testAccessibility(page, url) {
  try {
    // Check if URL is a PDF
    const isPdf = url.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      return await analyzePdf(url, page.context().browser());
    }

    // Inject axe-core library
    await page.addScriptTag({
      path: require.resolve('axe-core')
    });

    // Run axe-core analysis with WCAG 2.2 checks
    const axeResults = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        window.axe.configure({
          reporter: 'v2',
          // Enable all rules for maximum coverage including WCAG 2.2
          rules: [
            // Enable WCAG 2.2 specific rules
            { id: 'focus-visible-enhanced', enabled: true },
            { id: 'target-size', enabled: true },
            { id: 'dragging-movements', enabled: true },
            { id: 'accessible-authentication', enabled: true },
            { id: 'redundant-entry', enabled: true },
            { id: 'help-available', enabled: true },
            { id: 'focus-appearance-enhanced', enabled: true },
            // Enable all rules
            { id: '*', enabled: true }
          ]
        });
        
        window.axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice']
          }
        }, (err, results) => {
          if (err) resolve({ error: err.message });
          resolve(results);
        });
      });
    });

    // Run additional specialized analyzers
    const mediaResults = await analyzeMediaContent(page, url);
    const keyboardResults = await analyzeKeyboardNavigation(page, url);
    const manualReviewResults = await identifyManualReviewItems(page, url);
    const a11yStatementResults = await checkAccessibilityStatement(page, url);
    
    // Combine all violations
    const allViolations = [
      ...(axeResults.violations || []),
      ...(mediaResults.violations || []),
      ...(keyboardResults.violations || []),
      ...(manualReviewResults.violations || []),
      ...(a11yStatementResults.violations || [])
    ];
    
    // Calculate combined violation counts
    const violationCounts = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0
    };
    
    allViolations.forEach(violation => {
      const nodeCount = violation.nodes?.length || 0;
      violationCounts.total += nodeCount;
      
      // Map impact levels to our severity categories
      switch (violation.impact) {
        case 'critical':
        case 'serious':
          violationCounts.critical += nodeCount;
          break;
        case 'moderate':
        case 'minor':
          violationCounts.warning += nodeCount;
          break;
        default:
          violationCounts.info += nodeCount;
          break;
      }
    });
    
    // Return comprehensive results
    return {
      url,
      violations: allViolations,
      passes: axeResults.passes || [],
      incomplete: axeResults.incomplete || [],
      inapplicable: axeResults.inapplicable || [],
      violationCounts,
      additionalAnalysis: {
        hasMediaIssues: mediaResults.violationCounts.total > 0,
        hasKeyboardIssues: keyboardResults.violationCounts.total > 0,
        needsManualReview: manualReviewResults.violationCounts.total > 0,
        hasAccessibilityStatement: a11yStatementResults.violations.length === 0
      }
    };
  } catch (error) {
    logger.error(`Error testing accessibility for ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

/**
 * Crawls a website and tests pages for accessibility
 * @param {string} baseUrl - Starting URL
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @param {number} maxPages - Maximum number of pages to crawl
 * @param {number} currentDepth - Current crawl depth
 * @param {Function} progressCallback - Callback for reporting progress
 * @param {string} scanId - Unique scan identifier
 * @param {number} maxDepth - Maximum crawl depth
 * @returns {Promise<void>}
 */
async function crawlAndTest(baseUrl, browser, maxPages = 100, currentDepth = 1, progressCallback = () => {}, scanId, maxDepth = 5) {
  const visitedUrls = new Set();
  const queue = [{ url: baseUrl, depth: currentDepth }];
  let pagesScanned = 0;
  const allFoundUrls = new Set(); // Track all discovered URLs
  
  logger.info(`Starting crawl of ${baseUrl} with max ${maxPages} pages, max depth ${maxDepth}`);

  // Function to log current scanning status
  const logScanStatus = () => {
    logger.info(`Scan status for ${baseUrl}: Found ${allFoundUrls.size + queue.length} URLs, ${queue.length} in queue, ${pagesScanned}/${maxPages} pages scanned`);
  };

  // Initial status log
  logScanStatus();

  while (queue.length > 0 && pagesScanned < maxPages) {
    const { url, depth } = queue.shift();
    
    // Skip if already visited or exceeded max depth
    if (visitedUrls.has(url) || depth > maxDepth) continue;
    
    visitedUrls.add(url);
    
    try {
      logger.info(`Scanning page ${pagesScanned + 1}/${maxPages} (${queue.length} in queue): ${url}`);
      
      // Create new context and page for each URL to avoid state leakage
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 WCAG-Scanner/1.0'
      });
      
      const page = await context.newPage();
      let pageStatus = null;
      
      // Handle response status
      page.on('response', response => {
        if (response.url() === url) {
          pageStatus = response.status();
        }
      });

      // Set timeout for navigation
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      }).catch(err => {
        logger.warn(`Navigation timeout or error for ${url}: ${err.message}`);
      });

      // Test accessibility with enhanced tests
      const results = await testAccessibility(page, url);
      
      // Extract links if we're not at max depth
      let links = [];
      if (depth < maxDepth) {
        links = await page.evaluate(() => {
          const baseUrl = window.location.origin;
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => {
              try {
                const href = a.href;
                // Construct absolute URL
                if (!href.startsWith('http')) {
                  return new URL(href, baseUrl).href;
                }
                return href;
              } catch (e) {
                return null;
              }
            })
            .filter(url => {
              if (!url) return false;
              
              try {
                const urlObj = new URL(url);
                
                // Keep URLs from the same origin
                const sameOrigin = urlObj.origin === baseUrl;
                
                // Filter out common non-HTML resources
                const isLikelyPage = !url.match(/\.(jpg|jpeg|png|gif|pdf|zip|doc|xls|ppt|mp3|mp4|avi|mov|css|js|json|xml|woff|woff2|ttf|svg)$/i);
                
                // Skip anchor links to same page
                const notJustAnchor = !(urlObj.pathname === window.location.pathname && urlObj.hash);
                
                return sameOrigin && isLikelyPage && notJustAnchor;
              } catch (e) {
                return false;
              }
            });
        });
        
        // Also check for PDF files specifically to test them
        const pdfLinks = await page.evaluate(() => {
          const baseUrl = window.location.origin;
          return Array.from(document.querySelectorAll('a[href$=".pdf"]'))
            .map(a => {
              try {
                return new URL(a.href, baseUrl).href;
              } catch (e) {
                return null;
              }
            })
            .filter(url => url);
        });
        
        // Add PDFs to the links array
        links = [...links, ...pdfLinks];
        
        // Add new links to queue and to found URLs set
        let newLinksCount = 0;
        
        links.forEach(link => {
          if (!allFoundUrls.has(link)) {
            newLinksCount++;
            allFoundUrls.add(link); // Add to all found URLs
          }
          
          if (!visitedUrls.has(link) && !queue.some(item => item.url === link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        });
        
        // Log if we found significant new links
        if (newLinksCount > 0) {
          logger.info(`Found ${newLinksCount} new links on ${url}`);
          // If we've found a lot of new links, log the current status
          if (newLinksCount > 10) {
            logScanStatus();
          }
        }
      }
      
      // Store results in database including violationCounts
      await runAsync(
        'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            violations: results.violations,
            violationCounts: results.violationCounts,
            additionalAnalysis: results.additionalAnalysis
          }),
          JSON.stringify(links),
          pageStatus
        ]
      );
      
      // Close context
      await context.close();
      
      // Update progress with both scanned and found counts, and queue size
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, queue.length);
      
      // Log status periodically
      if (pagesScanned % 5 === 0 || queue.length % 20 === 0) {
        logScanStatus();
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`Error scanning ${url}: ${error.stack}`);
      
      // Store error in database
      await runAsync(
        'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            error: error.message,
            violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
          }),
          JSON.stringify([]),
          500 // Internal Server Error
        ]
      );
      
      // Still count this as a scanned page
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, queue.length);
    }
  }
  
  // Final log showing complete stats
  logger.info(`Crawl complete for ${baseUrl}: Found ${allFoundUrls.size} total URLs, scanned ${pagesScanned} pages`);
  
  // Update the scan status to completed
  await runAsync(
    'UPDATE scan_results SET status = ? WHERE scan_id = ? AND status IS NULL',
    ['completed', scanId]
  );
}

module.exports = {
  testAccessibility,
  crawlAndTest
};
