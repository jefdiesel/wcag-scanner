const fs = require('fs');
const path = require('path');
const { runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Import original analyzers
const { analyzePdf } = require('./analyzers/pdfAnalyzer');
const { analyzeMediaContent } = require('./analyzers/mediaAnalyzer');
const { analyzeKeyboardNavigation } = require('./analyzers/keyboardAnalyzer');
const { identifyManualReviewItems } = require('./analyzers/manualReviewAnalyzer');
const { checkAccessibilityStatement } = require('./analyzers/accessibilityStatementAnalyzer');

// Import new performance analyzers
const { analyzePageLoadPerformance } = require('./analyzers/performanceAnalyzer');
const { analyzeContentLoadingPatterns } = require('./analyzers/contentLoadingAnalyzer');
const { analyzeProgressiveRendering } = require('./analyzers/progressiveRenderingAnalyzer');
const { analyzeNetworkRequests } = require('./analyzers/networkRequestsAnalyzer');
const { analyzeAssetOptimization } = require('./analyzers/assetOptimizationAnalyzer');

/**
 * Tests page performance with focus on accessibility implications
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL to test
 * @returns {Promise<Object>} - Performance test results
 */
async function testPerformanceAccessibility(page, url) {
  try {
    // Check if URL is a PDF
    const isPdf = url.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // PDFs require special performance testing for accessibility
      return await analyzePdf(url, page.context().browser(), true); // Pass true to enable performance testing
    }

    // Inject performance measurement scripts
    await page.addScriptTag({
      content: `
        window.performanceData = {
          loadEvents: [],
          resourceLoadTimes: {},
          interactionDelays: [],
          contentVisibilityChanges: [],
          navigationStart: performance.timing ? performance.timing.navigationStart : performance.timeOrigin
        };
        
        // Track when content becomes visible
        const observer = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
              window.performanceData.contentVisibilityChanges.push({
                timestamp: performance.now(),
                elements: mutation.addedNodes.length
              });
            }
          });
        });
        
        observer.observe(document.body, { 
          childList: true, 
          subtree: true 
        });
        
        // Track page load events
        ['DOMContentLoaded', 'load'].forEach(event => {
          window.addEventListener(event, () => {
            window.performanceData.loadEvents.push({
              event: event,
              timestamp: performance.now()
            });
          });
        });
        
        // Track interaction delays
        const interactionEvents = ['click', 'keydown', 'touchstart'];
        interactionEvents.forEach(eventType => {
          document.addEventListener(eventType, (event) => {
            const startTime = performance.now();
            requestAnimationFrame(() => {
              const endTime = performance.now();
              window.performanceData.interactionDelays.push({
                type: eventType,
                target: event.target.tagName,
                delay: endTime - startTime
              });
            });
          }, { capture: true, passive: true });
        });
        
        // Track resource loading times
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          const url = args[0];
          const startTime = performance.now();
          
          return originalFetch.apply(this, args)
            .then(response => {
              const endTime = performance.now();
              window.performanceData.resourceLoadTimes[url] = {
                duration: endTime - startTime,
                size: null, // Will be updated when response is consumed
                contentType: response.headers.get('content-type')
              };
              return response;
            });
        };
      `
    });

    // Run specialized performance analyzers
    const pageLoadResults = await analyzePageLoadPerformance(page, url);
    const contentLoadingResults = await analyzeContentLoadingPatterns(page, url);
    const progressiveRenderingResults = await analyzeProgressiveRendering(page, url);
    const networkRequestsResults = await analyzeNetworkRequests(page, url);
    const assetOptimizationResults = await analyzeAssetOptimization(page, url);

    // Run standard accessibility tests to check for overlap with performance issues
    await page.addScriptTag({
      path: require.resolve('axe-core')
    });

    // Run axe-core analysis with focus on performance-related WCAG checks
    const axeResults = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        window.axe.configure({
          reporter: 'v2',
          rules: [
            // Performance-impacting WCAG rules
            { id: 'image-redundant-alt', enabled: true },
            { id: 'aria-hidden-focus', enabled: true },
            { id: 'duplicate-id-active', enabled: true },
            { id: 'duplicate-id-aria', enabled: true },
            { id: 'p-as-heading', enabled: true },
            { id: 'meta-viewport', enabled: true },
            { id: 'meta-refresh', enabled: true },
            { id: 'css-orientation-lock', enabled: true },
            { id: 'aria-hidden-body', enabled: true },
            // Enable all rules but prioritize performance impact
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

    // Collect performance metrics
    const performanceMetrics = await page.evaluate(() => {
      // Get all performance entries
      const perfEntries = performance.getEntriesByType('navigation')[0] || {};
      
      // Calculate First Contentful Paint using the Performance API
      let fcp = 0;
      const paintEntries = performance.getEntriesByType('paint');
      const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
      if (fcpEntry) {
        fcp = fcpEntry.startTime;
      }
      
      // Get Largest Contentful Paint if available
      let lcp = 0;
      if (window.LargestContentfulPaint) {
        lcp = window.LargestContentfulPaint.startTime;
      }
      
      // Calculate Cumulative Layout Shift if available
      let cls = 0;
      if (window.LayoutShiftAttribution) {
        cls = window.LayoutShiftAttribution.value;
      }
      
      // Calculate Time to Interactive (approximation)
      let tti = 0;
      if (perfEntries.domInteractive && window.performanceData.interactionDelays.length > 0) {
        const firstInteraction = Math.min(...window.performanceData.interactionDelays.map(d => d.timestamp));
        tti = perfEntries.domInteractive + firstInteraction;
      }
      
      return {
        // Standard performance metrics
        navigationStart: perfEntries.startTime || 0,
        domInteractive: perfEntries.domInteractive || 0,
        domContentLoaded: perfEntries.domContentLoadedEventEnd || 0,
        loadComplete: perfEntries.loadEventEnd || 0,
        
        // Web Vitals
        firstContentfulPaint: fcp,
        largestContentfulPaint: lcp,
        cumulativeLayoutShift: cls,
        timeToInteractive: tti,
        
        // Accessibility-specific metrics
        timeToFirstInteraction: window.performanceData.interactionDelays.length > 0 
          ? Math.min(...window.performanceData.interactionDelays.map(d => d.timestamp)) 
          : 0,
        averageInteractionDelay: window.performanceData.interactionDelays.length > 0 
          ? window.performanceData.interactionDelays.reduce((sum, d) => sum + d.delay, 0) / window.performanceData.interactionDelays.length 
          : 0,
        contentVisibilityTimeline: window.performanceData.contentVisibilityChanges,
        resourceLoadTimes: window.performanceData.resourceLoadTimes,
        
        // Custom calculations for accessibility impact 
        slowInteractions: window.performanceData.interactionDelays.filter(d => d.delay > 100).length,
        totalResources: Object.keys(window.performanceData.resourceLoadTimes).length,
        slowResources: Object.values(window.performanceData.resourceLoadTimes).filter(r => r.duration > 1000).length
      };
    });

    // Calculate a11y-specific performance score
    const performanceScore = calculatePerformanceScore(performanceMetrics);
    
    // Add accessibility implications to each performance issue
    const combinedIssues = combinePerformanceWithA11y(
      pageLoadResults.issues,
      contentLoadingResults.issues,
      progressiveRenderingResults.issues,
      networkRequestsResults.issues,
      assetOptimizationResults.issues,
      axeResults.violations
    );

    // Generate overall rating and prioritized issues
    const ratingByCategory = {
      pageLoad: calculateRating(pageLoadResults.score),
      contentLoading: calculateRating(contentLoadingResults.score),
      progressiveRendering: calculateRating(progressiveRenderingResults.score),
      networkRequests: calculateRating(networkRequestsResults.score),
      assetOptimization: calculateRating(assetOptimizationResults.score),
      overall: calculateRating(performanceScore)
    };
    
    // Categorize issues by severity for accessibility impact
    const categorizedIssues = categorizeBySeverity(combinedIssues);
    
    return {
      url,
      performanceMetrics,
      performanceScore,
      ratings: ratingByCategory,
      issues: categorizedIssues,
      axeViolations: axeResults.violations || [],
      recommendations: generateRecommendations(combinedIssues, performanceMetrics),
      detailedAnalysis: {
        pageLoad: pageLoadResults,
        contentLoading: contentLoadingResults,
        progressiveRendering: progressiveRenderingResults,
        networkRequests: networkRequestsResults,
        assetOptimization: assetOptimizationResults
      }
    };
  } catch (error) {
    logger.error(`Error testing performance accessibility for ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      performanceScore: 0,
      issues: [],
      recommendations: []
    };
  }
}

/**
 * Calculate an accessibility-focused performance score
 * @param {Object} metrics - Performance metrics
 * @returns {number} - Score between 0-100
 */
function calculatePerformanceScore(metrics) {
  // Weighted scoring based on accessibility impact
  const weights = {
    firstContentfulPaint: 10,
    largestContentfulPaint: 15,
    timeToInteractive: 25,
    cumulativeLayoutShift: 10, 
    averageInteractionDelay: 20,
    slowInteractions: 10,
    slowResources: 10
  };
  
  let score = 100;
  
  // FCP penalties (>1s is problematic, >3s is severe)
  if (metrics.firstContentfulPaint > 3000) {
    score -= weights.firstContentfulPaint;
  } else if (metrics.firstContentfulPaint > 1000) {
    score -= weights.firstContentfulPaint * 0.5;
  }
  
  // LCP penalties (>2.5s is problematic, >4s is severe)
  if (metrics.largestContentfulPaint > 4000) {
    score -= weights.largestContentfulPaint;
  } else if (metrics.largestContentfulPaint > 2500) {
    score -= weights.largestContentfulPaint * 0.5;
  }
  
  // TTI penalties (>3.8s is problematic, >7.3s is severe)
  if (metrics.timeToInteractive > 7300) {
    score -= weights.timeToInteractive;
  } else if (metrics.timeToInteractive > 3800) {
    score -= weights.timeToInteractive * 0.5;
  }
  
  // CLS penalties (>0.1 is problematic, >0.25 is severe)
  if (metrics.cumulativeLayoutShift > 0.25) {
    score -= weights.cumulativeLayoutShift;
  } else if (metrics.cumulativeLayoutShift > 0.1) {
    score -= weights.cumulativeLayoutShift * 0.5;
  }
  
  // Interaction delay penalties (>100ms is problematic, >300ms is severe)
  if (metrics.averageInteractionDelay > 300) {
    score -= weights.averageInteractionDelay;
  } else if (metrics.averageInteractionDelay > 100) {
    score -= weights.averageInteractionDelay * 0.5;
  }
  
  // Slow interactions penalties (based on percentage of slow interactions)
  const slowInteractionsRatio = metrics.slowInteractions / 
    (metrics.interactionDelays?.length || 1);
  if (slowInteractionsRatio > 0.5) {
    score -= weights.slowInteractions;
  } else if (slowInteractionsRatio > 0.2) {
    score -= weights.slowInteractions * 0.5;
  }
  
  // Slow resources penalties (based on percentage of slow resources)
  const slowResourcesRatio = metrics.slowResources / metrics.totalResources;
  if (slowResourcesRatio > 0.4) {
    score -= weights.slowResources;
  } else if (slowResourcesRatio > 0.2) {
    score -= weights.slowResources * 0.5;
  }
  
  // Ensure score is between 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Combine performance issues with accessibility violations
 * @param {...Array} issueSets - Sets of issues to combine
 * @returns {Array} - Combined issues with accessibility impact
 */
function combinePerformanceWithA11y(...issueSets) {
  const combinedIssues = [];
  
  // Process each set of issues
  issueSets.forEach(issues => {
    if (!issues || !Array.isArray(issues)) return;
    
    issues.forEach(issue => {
      // Add accessibility impact for performance issues
      if (!issue.a11yImpact) {
        let a11yImpact = 'low';
        let affectedUserGroups = [];
        
        // Determine impact based on issue type
        if (issue.type === 'slow-load-time') {
          a11yImpact = 'high';
          affectedUserGroups = [
            'cognitive', 
            'screen reader users', 
            'mobile users', 
            'low bandwidth users'
          ];
        } else if (issue.type === 'large-file-size') {
          a11yImpact = 'medium';
          affectedUserGroups = [
            'mobile users', 
            'low bandwidth users'
          ];
        } else if (issue.type === 'layout-shift') {
          a11yImpact = 'critical';
          affectedUserGroups = [
            'cognitive', 
            'low vision', 
            'screen magnifier users', 
            'motor impaired'
          ];
        } else if (issue.type === 'interaction-delay') {
          a11yImpact = 'high';
          affectedUserGroups = [
            'motor impaired', 
            'cognitive', 
            'keyboard users', 
            'switch control users'
          ];
        }
        
        issue.a11yImpact = a11yImpact;
        issue.affectedUserGroups = affectedUserGroups;
      }
      
      combinedIssues.push(issue);
    });
  });
  
  return combinedIssues;
}

/**
 * Categorize issues by severity for accessibility impact
 * @param {Array} issues - Combined issues
 * @returns {Object} - Issues categorized by severity
 */
function categorizeBySeverity(issues) {
  return {
    critical: issues.filter(issue => issue.a11yImpact === 'critical'),
    high: issues.filter(issue => issue.a11yImpact === 'high'),
    medium: issues.filter(issue => issue.a11yImpact === 'medium'),
    low: issues.filter(issue => issue.a11yImpact === 'low')
  };
}

/**
 * Calculate a rating from a score
 * @param {number} score - Score between 0-100
 * @returns {string} - Rating label
 */
function calculateRating(score) {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 60) return 'needs improvement';
  if (score >= 40) return 'poor';
  return 'critical';
}

/**
 * Generate specific recommendations based on issues
 * @param {Array} issues - Combined issues
 * @param {Object} metrics - Performance metrics
 * @returns {Array} - Prioritized recommendations
 */
function generateRecommendations(issues, metrics) {
  const recommendations = [];
  
  // Check for critical layout shift issues
  if (metrics.cumulativeLayoutShift > 0.25) {
    recommendations.push({
      priority: 'critical',
      issue: 'Excessive layout shifts detected',
      impact: 'Users with cognitive disabilities or who use screen magnifiers may lose track of content or controls',
      solution: 'Reserve space for dynamic content, set dimensions on images, avoid inserting content above existing content'
    });
  }
  
  // Check for slow interaction times
  if (metrics.averageInteractionDelay > 300) {
    recommendations.push({
      priority: 'critical',
      issue: 'Slow response to user interactions',
      impact: 'Users with motor impairments or cognitive disabilities may become confused or lose track of task',
      solution: 'Optimize event handlers, reduce main-thread blocking, implement optimistic UI updates'
    });
  }
  
  // Check for slow First Contentful Paint
  if (metrics.firstContentfulPaint > 3000) {
    recommendations.push({
      priority: 'high',
      issue: 'Slow initial content rendering',
      impact: 'Screen reader users have to wait before getting any content, users may think page is broken',
      solution: 'Implement server-side rendering or static generation, optimize critical rendering path, reduce blocking resources'
    });
  }
  
  // Add recommendations based on specific issues
  issues.forEach(issue => {
    if (issue.a11yImpact === 'critical' && !recommendations.some(r => r.issue === issue.description)) {
      recommendations.push({
        priority: 'critical',
        issue: issue.description,
        impact: `Affects ${issue.affectedUserGroups.join(', ')} users`,
        solution: issue.recommendation || 'Review and optimize the identified resource or process'
      });
    }
  });
  
  // Sort recommendations by priority
  return recommendations.sort((a, b) => {
    const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Crawls a website and tests pages for performance accessibility
 * @param {string} baseUrl - Starting URL
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @param {Object} options - Crawl options
 * @returns {Promise<void>}
 */
async function crawlAndTestPerformance(baseUrl, browser, options = {}) {
  // Extract options with defaults
  const {
    maxPages = 100,
    maxDepth = 5,
    throttling = {
      enabled: true,
      cpuSlowdown: 4,
      download: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps in bytes/second
      upload: 750 * 1024 / 8, // 750 Kbps in bytes/second
      latency: 150 // ms
    },
    deviceEmulation = {
      enabled: true,
      devices: ['Mobile', 'Tablet', 'Desktop']
    },
    progressCallback = () => {},
    scanId = Date.now().toString()
  } = options;
  
  const visitedUrls = new Set();
  const queue = [{ url: baseUrl, depth: 1 }];
  let pagesScanned = 0;
  const allFoundUrls = new Set();
  
  logger.info(`Starting performance accessibility crawl of ${baseUrl} with max ${maxPages} pages, max depth ${maxDepth}`);
  
  const deviceSettings = {
    Mobile: {
      viewport: { width: 375, height: 667 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 2
    },
    Tablet: {
      viewport: { width: 768, height: 1024 },
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 2
    },
    Desktop: {
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 WCAG-Performance-Scanner/1.0',
      deviceScaleFactor: 1
    }
  };
  
  // Function to log current scanning status
  const logScanStatus = () => {
    logger.info(`Performance scan status for ${baseUrl}: Found ${allFoundUrls.size + queue.length} URLs, ${queue.length} in queue, ${pagesScanned}/${maxPages} pages scanned`);
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
      
      // Test page on each device type if enabled
      const deviceTypes = deviceEmulation.enabled 
        ? deviceEmulation.devices 
        : ['Desktop']; // Default to desktop only
      
      const deviceResults = {};
      
      for (const deviceType of deviceTypes) {
        const deviceConfig = deviceSettings[deviceType];
        
        // Create context with device emulation
        const context = await browser.newContext({
          viewport: deviceConfig.viewport,
          userAgent: deviceConfig.userAgent,
          deviceScaleFactor: deviceConfig.deviceScaleFactor
        });
        
        // Apply network throttling if enabled
        if (throttling.enabled) {
          await context.route('**/*', route => {
            // Apply artificial delay to simulate latency
            setTimeout(() => route.continue(), throttling.latency);
          });
        }
        
        const page = await context.newPage();
        let pageStatus = null;
        
        // Handle response status
        page.on('response', response => {
          if (response.url() === url) {
            pageStatus = response.status();
          }
        });
        
        // Set CPU throttling via CDP if available and enabled
        if (throttling.enabled && browser.name() === 'chromium') {
          const cdpSession = await context.newCDPSession(page);
          await cdpSession.send('Emulation.setCPUThrottlingRate', {
            rate: throttling.cpuSlowdown
          });
        }
        
        // Set timeout for navigation
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 60000 // Longer timeout for performance testing
        }).catch(err => {
          logger.warn(`Navigation timeout or error for ${url} on ${deviceType}: ${err.message}`);
        });
        
        // Test performance accessibility
        const results = await testPerformanceAccessibility(page, url);
        deviceResults[deviceType] = results;
        
        // Extract links if we're testing on desktop and not at max depth
        let links = [];
        if (deviceType === 'Desktop' && depth < maxDepth) {
          links = await page.evaluate(() => {
            const baseUrl = window.location.origin;
            return Array.from(document.querySelectorAll('a[href]'))
              .map(a => {
                try {
                  const href = a.href;
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
          
          // Add PDF files for testing
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
          
          links = [...links, ...pdfLinks];
          
          // Add new links to queue and to found URLs set
          links.forEach(link => {
            if (!allFoundUrls.has(link)) {
              allFoundUrls.add(link);
            }
            
            if (!visitedUrls.has(link) && !queue.some(item => item.url === link)) {
              queue.push({ url: link, depth: depth + 1 });
            }
          });
        }
        
        // Close context
        await context.close();
      }
      
      // Combine results from all devices
      const combinedResults = {
        url,
        devices: deviceResults,
        worstPerformanceScore: Math.min(
          ...Object.values(deviceResults).map(r => r.performanceScore || 0)
        ),
        worstPerformingDevice: Object.entries(deviceResults)
          .sort(([, a], [, b]) => (a.performanceScore || 0) - (b.performanceScore || 0))[0][0],
        combinedIssues: Object.entries(deviceResults).flatMap(([device, result]) => 
          (result.issues?.critical || []).concat(result.issues?.high || [])
            .map(issue => ({ ...issue, device }))
        ),
        combinedRecommendations: [...new Set(
          Object.values(deviceResults).flatMap(r => r.recommendations || [])
            .map(rec => JSON.stringify(rec))
        )].map(rec => JSON.parse(rec))
      };
      
      // Store results in database
      await runAsync(
        'INSERT INTO performance_scan_results (scan_id, url, results, status, scanned_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify(combinedResults),
          pageStatus
        ]
      );
      
      // Update progress
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, queue.length);
      
      // Log status periodically
      if (pagesScanned % 5 === 0 || queue.length % 20 === 0) {
        logScanStatus();
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(`Error performance scanning ${url}: ${error.stack}`);
      
      // Store error in database
      await runAsync(
        'INSERT INTO performance_scan_results (scan_id, url, results, status, scanned_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            error: error.message,
            performanceScore: 0,
            issues: [],
            recommendations: []
          }),
          500 // Internal Server Error
        ]
      );
      
      // Still count this as a scanned page
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, queue.length);
    }
  }
  
  // Final log showing complete stats
  logger.info(`Performance crawl complete for ${baseUrl}: Found ${allFoundUrls.size} total URLs, scanned ${pagesScanned} pages`);
  
  // Update the scan status to completed
  await runAsync(
    'UPDATE performance_scan_results SET status = ? WHERE scan_id = ? AND status IS NULL',
    ['completed', scanId]
  );
}

module.exports = {
  testPerformanceAccessibility,
  crawlAndTestPerformance
};
