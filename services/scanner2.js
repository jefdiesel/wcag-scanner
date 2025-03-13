/**
 * Crawls a website and tests pages for accessibility
 */

const { runAsync } = require('../db/db');
const logger = require('../utils/logger');

/**
 * Normalize a URL to prevent duplicates
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  try {
    if (!url) return url;
    
    // Remove trailing slash if present (except for domain root)
    if (url.length > 0 && url.endsWith('/') && url.lastIndexOf('/') > 8) {
      return url.slice(0, -1);
    }
    return url;
  } catch (error) {
    logger.error(`Error normalizing URL ${url}: ${error.message}`);
    return url;
  }
}

/**
 * Test a page for accessibility issues
 * @param {import('playwright').Page} page - Playwright page to test
 * @param {string} url - URL being tested
 * @returns {Object} Test results
 */
async function testAccessibility(page, url) {
  try {
    // Initialize results
    const results = {
      violations: [],
      violationCounts: {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0
      },
      additionalAnalysis: {}
    };
    
    // Check for images without alt text (WCAG 1.1.1)
    const imagesWithoutAlt = await page.$$eval('img:not([alt])', (images) => {
      return images.map(img => ({
        element: img.outerHTML.slice(0, 100) + (img.outerHTML.length > 100 ? '...' : ''),
        src: img.src
      }));
    });
    
    if (imagesWithoutAlt.length > 0) {
      results.violations.push({
        id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alt text (WCAG 1.1.1)',
        help: 'Provide alternative text for images',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
        nodes: imagesWithoutAlt
      });
      
      results.violationCounts.total += imagesWithoutAlt.length;
      results.violationCounts.critical += imagesWithoutAlt.length;
    }
    
    // Check for empty links (WCAG 2.4.4)
    const emptyLinks = await page.$$eval('a', (links) => {
      return links.filter(link => {
        const text = link.textContent.trim();
        const ariaLabel = link.getAttribute('aria-label');
        const title = link.getAttribute('title');
        
        return !text && !ariaLabel && !title;
      }).map(link => ({
        element: link.outerHTML.slice(0, 100) + (link.outerHTML.length > 100 ? '...' : ''),
        href: link.href
      }));
    });
    
    if (emptyLinks.length > 0) {
      results.violations.push({
        id: 'link-name',
        impact: 'critical',
        description: 'Links must have discernible text (WCAG 2.4.4)',
        help: 'Provide text content for links',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html',
        nodes: emptyLinks
      });
      
      results.violationCounts.total += emptyLinks.length;
      results.violationCounts.critical += emptyLinks.length;
    }
    
    // Check for contrast issues (WCAG 1.4.3) - simplified check
    const lowContrastElements = await page.$$eval('*', (elements) => {
      return elements.filter(el => {
        // Skip elements without text
        if (!el.textContent.trim()) return false;
        
        // Skip hidden elements
        if (el.offsetHeight === 0 || el.offsetWidth === 0) return false;
        
        // Get computed styles
        const style = window.getComputedStyle(el);
        
        // Skip transparent elements
        if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
        
        // Simple contrast check - note this is just an approximation
        // Actual contrast calculation is more complex
        const bgColor = style.backgroundColor;
        const color = style.color;
        
        // If we have transparent bg color, skip this element
        if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
          return false;
        }
        
        // Very basic check - just looking for very similar colors
        // This isn't accurate but serves as a placeholder for proper contrast checks
        function getRGBFromColor(color) {
          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match) {
            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
          }
          return [0, 0, 0];
        }
        
        const bgRGB = getRGBFromColor(bgColor);
        const textRGB = getRGBFromColor(color);
        
        // Calculate very simple difference (not a real contrast ratio)
        const diff = Math.abs(bgRGB[0] - textRGB[0]) + 
                    Math.abs(bgRGB[1] - textRGB[1]) + 
                    Math.abs(bgRGB[2] - textRGB[2]);
        
        return diff < 150; // This is arbitrary; real contrast checks are more complex
      }).map(el => ({
        element: el.outerHTML.slice(0, 100) + (el.outerHTML.length > 100 ? '...' : ''),
        text: el.textContent.trim().slice(0, 50) + (el.textContent.length > 50 ? '...' : '')
      }));
    });
    
    if (lowContrastElements.length > 0) {
      // Limit to 20 elements to avoid huge reports
      const limitedElements = lowContrastElements.slice(0, 20);
      
      results.violations.push({
        id: 'color-contrast',
        impact: 'warning',
        description: 'Text elements should have sufficient contrast (WCAG 1.4.3)',
        help: 'Ensure text has sufficient color contrast',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
        nodes: limitedElements
      });
      
      results.violationCounts.total += limitedElements.length;
      results.violationCounts.warning += limitedElements.length;
    }
    
    // Check for missing form labels (WCAG 3.3.2)
    const inputsWithoutLabels = await page.$$eval('input, select, textarea', (formElements) => {
      return formElements.filter(el => {
        // Skip hidden inputs
        if (el.type === 'hidden') return false;
        
        // Check for explicit label
        const id = el.id;
        const hasExplicitLabel = id && document.querySelector(`label[for="${id}"]`);
        
        // Check for implicit label
        const hasImplicitLabel = el.closest('label');
        
        // Check for aria-label
        const hasAriaLabel = el.getAttribute('aria-label');
        
        // Check for aria-labelledby
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const hasAriaLabelledBy = ariaLabelledBy && document.getElementById(ariaLabelledBy);
        
        return !hasExplicitLabel && !hasImplicitLabel && !hasAriaLabel && !hasAriaLabelledBy;
      }).map(el => ({
        element: el.outerHTML.slice(0, 100) + (el.outerHTML.length > 100 ? '...' : ''),
        type: el.type || el.tagName.toLowerCase()
      }));
    });
    
    if (inputsWithoutLabels.length > 0) {
      results.violations.push({
        id: 'label',
        impact: 'critical',
        description: 'Form elements must have labels (WCAG 3.3.2)',
        help: 'Provide labels for all form controls',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
        nodes: inputsWithoutLabels
      });
      
      results.violationCounts.total += inputsWithoutLabels.length;
      results.violationCounts.critical += inputsWithoutLabels.length;
    }
    
    // Check for missing document language (WCAG 3.1.1)
    const hasLang = await page.evaluate(() => {
      return !!document.documentElement.getAttribute('lang');
    });
    
    if (!hasLang) {
      results.violations.push({
        id: 'html-has-lang',
        impact: 'warning',
        description: 'HTML element must have a lang attribute (WCAG 3.1.1)',
        help: 'Specify the language of the page',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html',
        nodes: [{ element: '<html>' }]
      });
      
      results.violationCounts.total += 1;
      results.violationCounts.warning += 1;
    }
    
    // Check for heading structure (WCAG 1.3.1, 2.4.6)
    const headings = await page.$$eval('h1, h2, h3, h4, h5, h6', (headings) => {
      return headings.map(heading => ({
        level: parseInt(heading.tagName.substring(1)),
        text: heading.textContent.trim().slice(0, 50) + (heading.textContent.length > 50 ? '...' : '')
      }));
    });
    
    const headingStructureIssues = [];
    
    // Check if there's an h1
    if (!headings.some(h => h.level === 1)) {
      headingStructureIssues.push('Page is missing a main heading (h1)');
    }
    
    // Check for skipped heading levels
    let prevLevel = 0;
    for (const heading of headings) {
      if (heading.level > prevLevel + 1 && prevLevel !== 0) {
        headingStructureIssues.push(`Heading level skipped from h${prevLevel} to h${heading.level}: "${heading.text}"`);
      }
      prevLevel = heading.level;
    }
    
    if (headingStructureIssues.length > 0) {
      results.violations.push({
        id: 'heading-order',
        impact: 'warning',
        description: 'Heading levels should not be skipped (WCAG 1.3.1, 2.4.6)',
        help: 'Use heading elements in a logical, sequential order',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
        nodes: headingStructureIssues.map(issue => ({ element: issue }))
      });
      
      results.violationCounts.total += headingStructureIssues.length;
      results.violationCounts.warning += headingStructureIssues.length;
    }
    
    // Check for keyboard accessibility issues (WCAG 2.1.1)
    const nonKeyboardElements = await page.$$eval('a[href], button, input, select, textarea, [tabindex]', (elements) => {
      return elements.filter(el => {
        // Skip hidden elements
        if (el.offsetHeight === 0 || el.offsetWidth === 0) return false;
        
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        
        // Check for negative tabindex
        const tabindex = el.getAttribute('tabindex');
        if (tabindex && parseInt(tabindex) < 0) return true;
        
        // Check for disabled controls that should be enabled
        if (el.hasAttribute('disabled') && !el.hasAttribute('aria-disabled')) return true;
        
        return false;
      }).map(el => ({
        element: el.outerHTML.slice(0, 100) + (el.outerHTML.length > 100 ? '...' : '')
      }));
    });
    
    if (nonKeyboardElements.length > 0) {
      results.violations.push({
        id: 'keyboard-accessible',
        impact: 'critical',
        description: 'Interactive elements must be keyboard accessible (WCAG 2.1.1)',
        help: 'Ensure all functionality is available via keyboard',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html',
        nodes: nonKeyboardElements
      });
      
      results.violationCounts.total += nonKeyboardElements.length;
      results.violationCounts.critical += nonKeyboardElements.length;
    }
    
    // Check for missing page title (WCAG 2.4.2)
    const pageTitle = await page.title();
    if (!pageTitle || pageTitle.trim() === '') {
      results.violations.push({
        id: 'document-title',
        impact: 'warning',
        description: 'Page must have a title (WCAG 2.4.2)',
        help: 'Provide a descriptive page title',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/page-titled.html',
        nodes: [{ element: '<title>' }]
      });
      
      results.violationCounts.total += 1;
      results.violationCounts.warning += 1;
    }
    
    // Check for ARIA roles (WCAG 4.1.2)
    const invalidAriaElements = await page.$$eval('[role]', (elements) => {
      const validRoles = [
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell',
        'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition',
        'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell',
        'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
        'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio',
        'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search',
        'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab',
        'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip',
        'tree', 'treegrid', 'treeitem'
      ];
      
      return elements.filter(el => {
        const role = el.getAttribute('role');
        return !validRoles.includes(role);
      }).map(el => ({
        element: el.outerHTML.slice(0, 100) + (el.outerHTML.length > 100 ? '...' : ''),
        role: el.getAttribute('role')
      }));
    });
    
    if (invalidAriaElements.length > 0) {
      results.violations.push({
        id: 'aria-roles',
        impact: 'warning',
        description: 'ARIA roles must be valid (WCAG 4.1.2)',
        help: 'Use valid ARIA roles',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
        nodes: invalidAriaElements
      });
      
      results.violationCounts.total += invalidAriaElements.length;
      results.violationCounts.warning += invalidAriaElements.length;
    }
    
    // Check for duplicate IDs (WCAG 4.1.1)
    const duplicateIds = await page.evaluate(() => {
      const elementsWithId = document.querySelectorAll('[id]');
      const ids = {};
      const duplicates = [];
      
      Array.from(elementsWithId).forEach(el => {
        const id = el.id;
        if (ids[id]) {
          duplicates.push({
            id: id,
            element: el.outerHTML.slice(0, 100) + (el.outerHTML.length > 100 ? '...' : '')
          });
        } else {
          ids[id] = true;
        }
      });
      
      return duplicates;
    });
    
    if (duplicateIds.length > 0) {
      results.violations.push({
        id: 'duplicate-id',
        impact: 'critical',
        description: 'IDs must be unique (WCAG 4.1.1)',
        help: 'Ensure all ID attribute values are unique',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/parsing.html',
        nodes: duplicateIds
      });
      
      results.violationCounts.total += duplicateIds.length;
      results.violationCounts.critical += duplicateIds.length;
    }
    
    // Check for empty buttons (WCAG 4.1.2)
    const emptyButtons = await page.$$eval('button', (buttons) => {
      return buttons.filter(button => {
        const text = button.textContent.trim();
        const ariaLabel = button.getAttribute('aria-label');
        const title = button.getAttribute('title');
        const hasVisibleText = text !== '';
        const hasImage = button.querySelector('img[alt]') !== null;
        
        return !hasVisibleText && !ariaLabel && !title && !hasImage;
      }).map(button => ({
        element: button.outerHTML.slice(0, 100) + (button.outerHTML.length > 100 ? '...' : '')
      }));
    });
    
    if (emptyButtons.length > 0) {
      results.violations.push({
        id: 'button-name',
        impact: 'critical',
        description: 'Buttons must have discernible text (WCAG 4.1.2)',
        help: 'Provide text content for buttons',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
        nodes: emptyButtons
      });
      
      results.violationCounts.total += emptyButtons.length;
      results.violationCounts.critical += emptyButtons.length;
    }
    
    return results;
  } catch (error) {
    logger.error(`Error testing accessibility for ${url}: ${error.message}`);
    return {
      violations: [{
        id: 'test-engine-error',
        impact: 'info',
        description: 'Error running accessibility tests',
        help: 'Check logs for details',
        nodes: [{ element: error.message }]
      }],
      violationCounts: {
        total: 1,
        critical: 0,
        warning: 0,
        info: 1
      },
      additionalAnalysis: {},
      error: error.message
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
  // Normalize the base URL
  baseUrl = normalizeUrl(baseUrl);
  
  // For internal tracking only
  const visitedUrls = new Set();
  const crawlQueue = [{ url: baseUrl, depth: currentDepth }];
  let pagesScanned = 0;
  const allFoundUrls = new Set(); // Track all discovered URLs
  
  logger.info(`Starting crawl of ${baseUrl} with max ${maxPages} pages, max depth ${maxDepth}`);

  // Function to log current scanning status
  const logScanStatus = () => {
    logger.info(`Scan status for ${baseUrl}: Found ${allFoundUrls.size} URLs, ${crawlQueue.length} in queue, ${pagesScanned}/${maxPages} pages scanned`);
  };

  // Initial status log
  logScanStatus();

  while (crawlQueue.length > 0 && pagesScanned < maxPages) {
    const { url, depth } = crawlQueue.shift();
    
    // Skip if already visited or exceeded max depth
    if (visitedUrls.has(url) || depth > maxDepth) continue;
    
    visitedUrls.add(url);
    
    try {
      logger.info(`Scanning page ${pagesScanned + 1}/${maxPages} (${crawlQueue.length} in queue): ${url}`);
      
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
        // Use a more controlled method to extract links
        links = await page.$$eval('a[href]', (anchors, baseUrl) => {
          return anchors.map(a => {
            try {
              // Get the href attribute
              let href = a.getAttribute('href');
              
              // Skip if empty or javascript: or mailto: links
              if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || 
                  href.startsWith('#') || href === '/') {
                return null;
              }
              
              // Convert to absolute URL
              let absoluteUrl;
              try {
                absoluteUrl = new URL(href, baseUrl).href;
              } catch (e) {
                return null;
              }
              
              // Very strict filtering - only allow clean URLs
              try {
                const urlObj = new URL(absoluteUrl);
                
                // Must be http or https
                if (!urlObj.protocol.startsWith('http')) {
                  return null;
                }
                
                // Must be same origin
                if (urlObj.origin !== new URL(baseUrl).origin) {
                  return null;
                }
                
                // No file extensions we don't want to crawl
                if (urlObj.pathname.match(/\.(jpg|jpeg|png|gif|css|js|json|xml|zip|doc|xls|mp3|mp4|avi|mov|woff|woff2|ttf|svg)$/i)) {
                  return null;
                }
                
                // No fragments
                urlObj.hash = '';
                
                return urlObj.href;
              } catch (e) {
                return null;
              }
            } catch (e) {
              return null;
            }
          }).filter(url => url !== null);
        }, url);
        
        // Further filter the links on the server side
        links = links.filter(link => {
          try {
            // Only keep very clean URLs from same domain
            const linkUrl = new URL(link);
            const baseUrlObj = new URL(baseUrl);
            
            // Must be from same hostname
            return linkUrl.hostname === baseUrlObj.hostname;
          } catch (e) {
            return false;
          }
        });
        
        // Normalize all URLs to prevent variants
        links = links.map(link => normalizeUrl(link));
        
        // Remove duplicates
        links = [...new Set(links)];
        
        // Add new links to INTERNAL crawlQueue only - NOT to the database queue
        let newLinksCount = 0;
        
        links.forEach(link => {
          if (!allFoundUrls.has(link)) {
            newLinksCount++;
            allFoundUrls.add(link); // Add to all found URLs
          }
          
          // Only add to internal crawl queue if not already visited or in queue
          if (!visitedUrls.has(link) && !crawlQueue.some(item => item.url === link)) {
            crawlQueue.push({ url: link, depth: depth + 1 });
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
      
      // Store results in database including links found (for reporting purposes only)
      // IMPORTANT: We're just storing links for reporting, not adding them to the main queue
      try {
        await runAsync(
          'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at, error_message) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
          [
            scanId,
            url,
            JSON.stringify({ 
              violations: results.violations,
              violationCounts: results.violationCounts,
              additionalAnalysis: results.additionalAnalysis
            }),
            JSON.stringify(links),
            pageStatus,
            null
          ]
        );
      } catch (dbError) {
        // Handle case where error_message column might not exist
        if (dbError.message && dbError.message.includes('error_message')) {
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
        } else {
          throw dbError;
        }
      }
      
      // Close context
      await context.close();
      
      // Update progress with both scanned and found counts, and queue size
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, crawlQueue.length);
      
      // Log status periodically
      if (pagesScanned % 5 === 0 || crawlQueue.length % 20 === 0) {
        logScanStatus();
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`Error scanning ${url}: ${error.stack}`);
      
      // Store error in database
      try {
        await runAsync(
          'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at, error_message) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
          [
            scanId,
            url,
            JSON.stringify({ 
              error: error.message,
              violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
            }),
            JSON.stringify([]),
            500, // Internal Server Error
            error.message
          ]
        );
      } catch (dbError) {
        // Handle case where error_message might not exist
        if (dbError.message && dbError.message.includes('error_message')) {
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
        } else {
          logger.error(`Database error when storing scan error: ${dbError.message}`);
        }
      }
      
      // Still count this as a scanned page
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, crawlQueue.length);
    }
  }
  
  // Final log showing complete stats
  logger.info(`Crawl complete for ${baseUrl}: Found ${allFoundUrls.size} total URLs, scanned ${pagesScanned} pages`);
  
  // Update the scan status to completed
  try {
    await runAsync(
      'UPDATE scan_results SET status = ? WHERE scan_id = ? AND url = ?',
      ['completed', scanId, baseUrl]
    );
  } catch (error) {
    logger.error(`Error updating scan status: ${error.message}`);
  }
}

// Export both functions
module.exports = { 
  crawlAndTest,
  normalizeUrl,
  testAccessibility 
};
