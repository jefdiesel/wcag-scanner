/**
 * Performance Analyzer for Accessibility
 * Analyzes page load performance with a focus on accessibility implications
 */

const logger = require('../../utils/logger');

/**
 * Analyzes page load performance with focus on accessibility
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL being tested
 * @returns {Promise<Object>} - Performance analysis results
 */
async function analyzePageLoadPerformance(page, url) {
  try {
    // Collect performance metrics that impact accessibility
    const metrics = await page.evaluate(() => {
      // Get navigation timing data
      const navTiming = performance.getEntriesByType('navigation')[0] || {};
      
      // Get paint timing data
      const paintTimings = performance.getEntriesByType('paint');
      const firstPaint = paintTimings.find(t => t.name === 'first-paint');
      const firstContentfulPaint = paintTimings.find(t => t.name === 'first-contentful-paint');
      
      // Calculate Long Tasks using PerformanceObserver if available
      let longTasks = [];
      if (typeof PerformanceLongTaskTiming !== 'undefined') {
        longTasks = performance.getEntriesByType('longtask') || [];
      }
      
      // Get resource timing data
      const resources = performance.getEntriesByType('resource');
      
      // Get total blocking time (approximation)
      let totalBlockingTime = 0;
      if (longTasks.length > 0) {
        totalBlockingTime = longTasks.reduce((sum, task) => sum + task.duration, 0);
      }
      
      // Check if the page has aria landmarks
      const hasAriaLandmarks = document.querySelectorAll('[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"]').length > 0;
      
      return {
        // Basic timing
        navigationStart: navTiming.startTime || 0,
        redirectTime: (navTiming.redirectEnd || 0) - (navTiming.redirectStart || 0),
        dnsTime: (navTiming.domainLookupEnd || 0) - (navTiming.domainLookupStart || 0),
        connectTime: (navTiming.connectEnd || 0) - (navTiming.connectStart || 0),
        requestTime: (navTiming.responseStart || 0) - (navTiming.requestStart || 0),
        responseTime: (navTiming.responseEnd || 0) - (navTiming.responseStart || 0),
        domProcessingTime: (navTiming.domComplete || 0) - (navTiming.responseEnd || 0),
        loadEventTime: (navTiming.loadEventEnd || 0) - (navTiming.loadEventStart || 0),
        
        // Critical metrics for accessibility
        firstPaint: firstPaint ? firstPaint.startTime : 0,
        firstContentfulPaint: firstContentfulPaint ? firstContentfulPaint.startTime : 0,
        domInteractive: navTiming.domInteractive || 0,
        domContentLoaded: navTiming.domContentLoadedEventEnd || 0,
        timeToInteractive: navTiming.domInteractive ? navTiming.domInteractive + (totalBlockingTime || 0) : 0,
        
        // Resource analysis
        totalResources: resources.length,
        totalResourceBytes: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
        scriptCount: resources.filter(r => r.initiatorType === 'script').length,
        styleCount: resources.filter(r => r.initiatorType === 'css').length,
        imageCount: resources.filter(r => r.initiatorType === 'img').length,
        fontCount: resources.filter(r => r.initiatorType === 'css' && r.name.match(/\.(woff2?|ttf|otf|eot)/i)).length,
        
        // Long task analysis
        longTaskCount: longTasks.length,
        totalBlockingTime,
        
        // Accessibility timing metrics
        hasAriaLandmarks,
        timeToFirstInteraction: window.performanceData?.interactionDelays?.length > 0 
          ? Math.min(...window.performanceData.interactionDelays.map(d => d.timestamp)) 
          : 0,
      };
    });
    
    // Assess issues based on metrics
    const issues = [];
    
    // Slow First Contentful Paint
    if (metrics.firstContentfulPaint > 2000) {
      issues.push({
        type: 'slow-fcp',
        description: 'Slow First Contentful Paint',
        value: `${(metrics.firstContentfulPaint / 1000).toFixed(2)}s`,
        threshold: '2s',
        impact: 'high',
        affectedGroups: ['cognitive disabilities', 'screen reader users', 'elderly users'],
        recommendation: 'Optimize critical rendering path by reducing render-blocking resources and prioritizing visible content',
        wcagCriteria: ['2.2.1 Timing Adjustable', '1.4.8 Visual Presentation'],
        elements: []
      });
    }
    
    // Slow Time to Interactive
    if (metrics.timeToInteractive > 3500) {
      issues.push({
        type: 'slow-tti',
        description: 'Slow Time to Interactive',
        value: `${(metrics.timeToInteractive / 1000).toFixed(2)}s`,
        threshold: '3.5s',
        impact: 'critical',
        affectedGroups: ['motor disabilities', 'switch control users', 'keyboard users'],
        recommendation: 'Reduce JavaScript execution time, split code into smaller chunks, and defer non-critical JavaScript',
        wcagCriteria: ['2.2.1 Timing Adjustable', '2.5.3 Label in Name'],
        elements: []
      });
    }
    
    // Long tasks blocking the main thread
    if (metrics.totalBlockingTime > 300) {
      issues.push({
        type: 'main-thread-blocking',
        description: 'Excessive main thread blocking',
        value: `${metrics.totalBlockingTime.toFixed(0)}ms`,
        threshold: '300ms',
        impact: 'high',
        affectedGroups: ['screen reader users', 'keyboard users', 'switch control users'],
        recommendation: 'Break up long tasks, move work off the main thread using Web Workers, and optimize JavaScript execution',
        wcagCriteria: ['2.2.1 Timing Adjustable', '2.2.7 User-initiated Timeouts'],
        elements: []
      });
    }
    
    // Too many resources loading
    if (metrics.totalResources > 80) {
      issues.push({
        type: 'excessive-resources',
        description: 'Excessive number of resources',
        value: metrics.totalResources.toString(),
        threshold: '80',
        impact: 'medium',
        affectedGroups: ['low bandwidth users', 'mobile users', 'cognitive disabilities'],
        recommendation: 'Consolidate resources, use bundling, and eliminate unused resources',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Large page size
    if (metrics.totalResourceBytes > 3 * 1024 * 1024) { // 3MB
      issues.push({
        type: 'large-page-size',
        description: 'Excessive page size',
        value: `${(metrics.totalResourceBytes / (1024 * 1024)).toFixed(2)}MB`,
        threshold: '3MB',
        impact: 'high',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users in rural areas'],
        recommendation: 'Compress images, minify CSS/JS, use code splitting, and implement lazy loading',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Missing ARIA landmarks for screen readers
    if (!metrics.hasAriaLandmarks) {
      issues.push({
        type: 'missing-landmarks',
        description: 'Missing ARIA landmarks for navigation',
        impact: 'medium',
        affectedGroups: ['screen reader users', 'keyboard users'],
        recommendation: 'Add appropriate ARIA landmarks (main, navigation, banner, contentinfo) to improve navigation for screen reader users',
        wcagCriteria: ['2.4.1 Bypass Blocks', '1.3.1 Info and Relationships'],
        elements: []
      });
    }
    
    // Calculate score based on performance metrics
    let score = 100;
    
    // Penalize for slow First Contentful Paint
    if (metrics.firstContentfulPaint > 3000) score -= 20;
    else if (metrics.firstContentfulPaint > 2000) score -= 10;
    else if (metrics.firstContentfulPaint > 1000) score -= 5;
    
    // Penalize for slow Time to Interactive
    if (metrics.timeToInteractive > 5000) score -= 25;
    else if (metrics.timeToInteractive > 3500) score -= 15;
    else if (metrics.timeToInteractive > 2500) score -= 5;
    
    // Penalize for main thread blocking
    if (metrics.totalBlockingTime > 500) score -= 15;
    else if (metrics.totalBlockingTime > 300) score -= 10;
    else if (metrics.totalBlockingTime > 100) score -= 5;
    
    // Penalize for excessive resources
    if (metrics.totalResources > 100) score -= 10;
    else if (metrics.totalResources > 80) score -= 5;
    
    // Penalize for large page size
    if (metrics.totalResourceBytes > 5 * 1024 * 1024) score -= 15;
    else if (metrics.totalResourceBytes > 3 * 1024 * 1024) score -= 10;
    else if (metrics.totalResourceBytes > 1.5 * 1024 * 1024) score -= 5;
    
    // Penalize for missing ARIA landmarks
    if (!metrics.hasAriaLandmarks) score -= 10;
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      metrics,
      issues,
      score,
      url
    };
  } catch (error) {
    logger.error(`Error analyzing page load performance for ${url}: ${error.message}`);
    return {
      metrics: {},
      issues: [{ 
        type: 'analysis-error', 
        description: `Error analyzing page load performance: ${error.message}`,
        impact: 'unknown'
      }],
      score: 0,
      url
    };
  }
}

/**
 * Analyzes content loading patterns with focus on accessibility
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL being tested
 * @returns {Promise<Object>} - Content loading analysis results
 */
async function analyzeContentLoadingPatterns(page, url) {
  try {
    // Get content loading metrics
    const metrics = await page.evaluate(() => {
      // Track visibility of important elements
      const checkElementVisibility = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        
        const rect = element.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0 && 
               rect.left < window.innerWidth && rect.right > 0;
      };
      
      // Detect if the page has a skeleton loading pattern
      const hasSkeletonLoading = !!document.querySelector('[aria-busy="true"], [role="progressbar"], .skeleton, .loading-placeholder');
      
      // Check for progressive content loading
      const hasProgressiveLoading = window.performanceData?.contentVisibilityChanges?.length > 3;
      
      // Check if the page has loading indicators
      const hasLoadingIndicators = !!document.querySelector('[role="progressbar"], [aria-busy="true"], .loading, .spinner');
      
      // Check if there's an accessible announcement area for loading status
      const hasA11yLoadingAnnouncement = !!document.querySelector('[aria-live="polite"], [aria-live="assertive"]');
      
      // Check if main content is visible without scrolling
      const mainContentVisible = checkElementVisibility('main') || 
                                 checkElementVisibility('[role="main"]') || 
                                 checkElementVisibility('#content') ||
                                 checkElementVisibility('.content');
      
      // Detect if headers render before content
      const headersRenderFirst = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 0;
      
      return {
        hasSkeletonLoading,
        hasProgressiveLoading,
        hasLoadingIndicators,
        hasA11yLoadingAnnouncement,
        mainContentVisible,
        headersRenderFirst,
        contentVisibilityChanges: window.performanceData?.contentVisibilityChanges || [],
        domSize: document.querySelectorAll('*').length
      };
    });
    
    // Assess issues based on metrics
    const issues = [];
    
    // Missing loading indicators
    if (!metrics.hasLoadingIndicators && 
        (metrics.contentVisibilityChanges.length > 5 || metrics.domSize > 1000)) {
      issues.push({
        type: 'missing-loading-indicator',
        description: 'Missing loading indicators for dynamic content',
        impact: 'high',
        affectedGroups: ['screen reader users', 'cognitive disabilities'],
        recommendation: 'Add visible loading indicators with appropriate ARIA attributes (aria-busy="true" or role="progressbar") for dynamically loading content',
        wcagCriteria: ['2.2.1 Timing Adjustable', '4.1.3 Status Messages'],
        elements: []
      });
    }
    
    // Missing accessible loading announcements
    if (!metrics.hasA11yLoadingAnnouncement && 
        (metrics.contentVisibilityChanges.length > 3 || metrics.hasLoadingIndicators)) {
      issues.push({
        type: 'missing-a11y-announcement',
        description: 'Missing accessible loading status announcements',
        impact: 'critical',
        affectedGroups: ['screen reader users', 'keyboard users'],
        recommendation: 'Add an aria-live region to announce loading status changes to screen reader users',
        wcagCriteria: ['4.1.3 Status Messages', '3.2.1 On Focus'],
        elements: []
      });
    }
    
    // Main content not visible without scrolling
    if (!metrics.mainContentVisible) {
      issues.push({
        type: 'main-content-not-visible',
        description: 'Main content not visible in initial viewport',
        impact: 'medium',
        affectedGroups: ['cognitive disabilities', 'low vision users', 'elderly users'],
        recommendation: 'Ensure main content is visible without requiring scrolling, or provide clear indication of content location',
        wcagCriteria: ['2.4.1 Bypass Blocks', '1.3.2 Meaningful Sequence'],
        elements: []
      });
    }
    
    // Headers not rendering before content
    if (!metrics.headersRenderFirst) {
      issues.push({
        type: 'headers-not-first',
        description: 'Headings not rendering before main content',
        impact: 'medium',
        affectedGroups: ['screen reader users', 'cognitive disabilities'],
        recommendation: 'Ensure headings load early in the rendering process to provide immediate context to users',
        wcagCriteria: ['1.3.1 Info and Relationships', '2.4.6 Headings and Labels'],
        elements: []
      });
    }
    
    // Calculate score based on content loading patterns
    let score = 100;
    
    // Penalize for missing loading indicators
    if (!metrics.hasLoadingIndicators && 
        (metrics.contentVisibilityChanges.length > 5 || metrics.domSize > 1000)) {
      score -= 15;
    }
    
    // Penalize for missing accessible loading announcements
    if (!metrics.hasA11yLoadingAnnouncement && 
        (metrics.contentVisibilityChanges.length > 3 || metrics.hasLoadingIndicators)) {
      score -= 20;
    }
    
    // Penalize for main content not visible without scrolling
    if (!metrics.mainContentVisible) {
      score -= 10;
    }
    
    // Penalize for headers not rendering before content
    if (!metrics.headersRenderFirst) {
      score -= 10;
    }
    
    // Bonus for using skeleton loading
    if (metrics.hasSkeletonLoading) {
      score += 5;
    }
    
    // Bonus for progressive loading
    if (metrics.hasProgressiveLoading) {
      score += 5;
    }
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      metrics,
      issues,
      score,
      url
    };
  } catch (error) {
    logger.error(`Error analyzing content loading patterns for ${url}: ${error.message}`);
    return {
      metrics: {},
      issues: [{ 
        type: 'analysis-error', 
        description: `Error analyzing content loading patterns: ${error.message}`,
        impact: 'unknown'
      }],
      score: 0,
      url
    };
  }
}

/**
 * Analyzes progressive rendering from an accessibility perspective
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL being tested
 * @returns {Promise<Object>} - Progressive rendering analysis results
 */
async function analyzeProgressiveRendering(page, url) {
  try {
    // Collect metrics about progressive rendering
    const metrics = await page.evaluate(() => {
      // Check for layout shifts
      const hasLayoutShifts = typeof LayoutShift !== 'undefined' && 
                              performance.getEntriesByType('layout-shift').length > 0;
      
      // Calculate cumulative layout shift if available
      let cumulativeLayoutShift = 0;
      if (typeof LayoutShift !== 'undefined') {
        const layoutShifts = performance.getEntriesByType('layout-shift') || [];
        cumulativeLayoutShift = layoutShifts.reduce((sum, shift) => sum + shift.value, 0);
      }
      
      // Check if content jumps during loading
      const contentJumps = cumulativeLayoutShift > 0.1;
      
      // Check if images have dimensions specified
      const images = Array.from(document.querySelectorAll('img'));
      const imagesWithDimensions = images.filter(img => 
        img.hasAttribute('width') && img.hasAttribute('height')
      ).length;
      
      // Check if fonts load with FOIT (Flash of Invisible Text)
      const hasFontDisplayNone = document.querySelectorAll('style').length > 0 && 
                              Array.from(document.querySelectorAll('style'))
                                .some(style => style.textContent.includes('font-display: block') || 
                                               style.textContent.includes('font-display: swap'));
      
      // Check for content that appears after user interaction
      const hasDelayedContent = document.querySelectorAll('[hidden], [aria-hidden="true"]').length > 0;
      
      return {
        hasLayoutShifts,
        cumulativeLayoutShift,
        contentJumps,
        imagesWithDimensions: imagesWithDimensions,
        totalImages: images.length,
        hasFontDisplayNone,
        hasDelayedContent
      };
    });
    
    // Assess issues based on metrics
    const issues = [];
    
    // Cumulative Layout Shift
    if (metrics.cumulativeLayoutShift > 0.25) {
      issues.push({
        type: 'excessive-layout-shift',
        description: 'Excessive layout shifts during page load',
        value: metrics.cumulativeLayoutShift.toFixed(2),
        threshold: '0.25',
        impact: 'critical',
        affectedGroups: ['motor disabilities', 'cognitive disabilities', 'low vision users', 'screen magnifier users'],
        recommendation: 'Reserve space for dynamic content, set dimensions for images and media, and avoid inserting content above existing content',
        wcagCriteria: ['2.2.2 Pause, Stop, Hide', '1.3.2 Meaningful Sequence'],
        elements: []
      });
    } else if (metrics.cumulativeLayoutShift > 0.1) {
      issues.push({
        type: 'layout-shift',
        description: 'Layout shifts during page load',
        value: metrics.cumulativeLayoutShift.toFixed(2),
        threshold: '0.1',
        impact: 'high',
        affectedGroups: ['motor disabilities', 'cognitive disabilities', 'low vision users'],
        recommendation: 'Reserve space for dynamic content and set dimensions for images',
        wcagCriteria: ['2.2.2 Pause, Stop, Hide'],
        elements: []
      });
    }
    
    // Missing image dimensions
    if (metrics.totalImages > 5 && metrics.imagesWithDimensions / metrics.totalImages < 0.7) {
      issues.push({
        type: 'missing-image-dimensions',
        description: 'Images missing width and height attributes',
        value: `${Math.round((metrics.imagesWithDimensions / metrics.totalImages) * 100)}%`,
        threshold: '70%',
        impact: 'medium',
        affectedGroups: ['cognitive disabilities', 'low vision users'],
        recommendation: 'Set explicit width and height attributes on all images to prevent layout shifts',
        wcagCriteria: ['1.4.8 Visual Presentation'],
        elements: []
      });
    }
    
    // Font loading issues
    if (!metrics.hasFontDisplayNone) {
      issues.push({
        type: 'font-loading-issues',
        description: 'Fonts may cause Flash of Invisible Text (FOIT)',
        impact: 'medium',
        affectedGroups: ['cognitive disabilities', 'low vision users', 'users with reading difficulties'],
        recommendation: 'Use font-display: swap or font-display: fallback CSS property to ensure text remains visible during font loading',
        wcagCriteria: ['1.4.8 Visual Presentation'],
        elements: []
      });
    }
    
    // Calculate score based on progressive rendering issues
    let score = 100;
    
    // Penalize for layout shifts
    if (metrics.cumulativeLayoutShift > 0.25) score -= 25;
    else if (metrics.cumulativeLayoutShift > 0.1) score -= 15;
    
    // Penalize for missing image dimensions
    if (metrics.totalImages > 5) {
      const imageDimensionsRatio = metrics.imagesWithDimensions / metrics.totalImages;
      if (imageDimensionsRatio < 0.5) score -= 15;
      else if (imageDimensionsRatio < 0.7) score -= 10;
      else if (imageDimensionsRatio < 0.9) score -= 5;
    }
    
    // Penalize for font loading issues
    if (!metrics.hasFontDisplayNone) score -= 10;
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      metrics,
      issues,
      score,
      url
    };
  } catch (error) {
    logger.error(`Error analyzing progressive rendering for ${url}: ${error.message}`);
    return {
      metrics: {},
      issues: [{ 
        type: 'analysis-error', 
        description: `Error analyzing progressive rendering: ${error.message}`,
        impact: 'unknown'
      }],
      score: 0,
      url
    };
  }
}

/**
 * Analyzes network requests from an accessibility perspective
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL being tested
 * @returns {Promise<Object>} - Network requests analysis results
 */
async function analyzeNetworkRequests(page, url) {
  try {
    // Get network request metrics from Chrome DevTools Protocol if available
    let requestMetrics = { requests: [] };
    
    if (page.context().browser().name() === 'chromium') {
      const client = await page.context().newCDPSession(page);
      
      // Enable network domain to track requests
      await client.send('Network.enable');
      
      // Collect request data
      const requests = [];
      const requestMap = new Map();
      
      // Setup listeners before reloading
      client.on('Network.requestWillBeSent', request => {
        requestMap.set(request.requestId, {
          url: request.request.url,
          type: request.type,
          startTime: request.timestamp,
          endTime: null,
          duration: null,
          size: null,
          priority: request.request.priority
        });
      });
      
      client.on('Network.responseReceived', response => {
        const request = requestMap.get(response.requestId);
        if (request) {
          request.endTime = response.timestamp;
          request.duration = (response.timestamp - request.startTime) * 1000; // Convert to ms
          request.size = response.response.encodedDataLength;
          request.status = response.response.status;
          request.mimeType = response.response.mimeType;
        }
      });
      
      // Reload page to capture all requests from the beginning
      await page.reload({ waitUntil: 'networkidle' });
      
      // Convert map to array for analysis
      requestMap.forEach(request => {
        if (request.endTime) { // Only include completed requests
          requests.push(request);
        }
      });
      
      // Process collected requests
      const totalSize = requests.reduce((sum, req) => sum + (req.size || 0), 0);
      const totalDuration = requests.length > 0 ? 
        Math.max(...requests.filter(req => req.duration).map(req => req.duration)) : 0;
      
      const slowRequests = requests.filter(req => req.duration > 1000);
      const largeRequests = requests.filter(req => req.size > 1 * 1024 * 1024); // 1MB
      
      const requestsByType = {};
      requests.forEach(req => {
        const type = req.type || 'other';
        if (!requestsByType[type]) requestsByType[type] = [];
        requestsByType[type].push(req);
      });
      
      // Check for critical blocking resources
      const blockingResources = requests.filter(req => 
        (req.type === 'script' || req.type === 'stylesheet') && 
        req.priority === 'VeryHigh' && 
        req.duration > 500
      );
      
      requestMetrics = {
        requests,
        totalRequests: requests.length,
        totalSize,
        totalDuration,
        slowRequests,
        largeRequests,
        requestsByType,
        blockingResources
      };
    } else {
      // Fallback to basic Performance API metrics for non-Chromium browsers
      requestMetrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const totalSize = resources.reduce((sum, res) => sum + (res.transferSize || 0), 0);
        const totalDuration = resources.length > 0 ? 
          Math.max(...resources.map(res => res.duration)) : 0;
        
        const slowRequests = resources.filter(res => res.duration > 1000);
        
        return {
          totalRequests: resources.length,
          totalSize,
          totalDuration,
          slowRequests: slowRequests.length,
          blockingResources: resources.filter(res => 
            (res.initiatorType === 'script' || res.initiatorType === 'css') && 
            res.duration > 500
          ).length
        };
      });
    }
    
    // Assess issues based on metrics
    const issues = [];
    
    // Too many requests
    if (requestMetrics.totalRequests > 100) {
      issues.push({
        type: 'excessive-requests',
        description: 'Excessive number of network requests',
        value: requestMetrics.totalRequests.toString(),
        threshold: '100',
        impact: 'high',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users in rural areas'],
        recommendation: 'Reduce the number of requests by combining files, using sprites, and implementing HTTP/2 server push',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Slow blocking resources
    if (requestMetrics.blockingResources && requestMetrics.blockingResources.length > 0) {
      issues.push({
        type: 'blocking-resources',
        description: 'Render-blocking resources delaying page display',
        value: requestMetrics.blockingResources.length.toString(),
        impact: 'high',
        affectedGroups: ['all users', 'particularly those with cognitive disabilities'],
        recommendation: 'Move render-blocking scripts to the end of the body, use async/defer for scripts, and inline critical CSS',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Slow requests
    if (requestMetrics.slowRequests && requestMetrics.slowRequests.length > 3) {
      issues.push({
        type: 'slow-requests',
        description: 'Multiple slow network requests (>1s)',
        value: requestMetrics.slowRequests.length.toString(),
        threshold: '3',
        impact: 'medium',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users with cognitive disabilities'],
        recommendation: 'Optimize server response times, implement caching, and consider using a CDN',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Large requests
    if (requestMetrics.largeRequests && requestMetrics.largeRequests.length > 0) {
      issues.push({
        type: 'large-requests',
        description: 'Large network requests (>1MB)',
        value: requestMetrics.largeRequests.length.toString(),
        impact: 'high',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users with data limitations'],
        recommendation: 'Compress resources, optimize images, and implement lazy loading for large content',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Calculate score based on network requests
    let score = 100;
    
    // Penalize for too many requests
    if (requestMetrics.totalRequests > 150) score -= 20;
    else if (requestMetrics.totalRequests > 100) score -= 10;
else if (requestMetrics.totalRequests > 50) score -= 5;
    
    // Penalize for blocking resources
    if (requestMetrics.blockingResources && requestMetrics.blockingResources.length > 5) score -= 20;
    else if (requestMetrics.blockingResources && requestMetrics.blockingResources.length > 2) score -= 10;
    
    // Penalize for slow requests
    if (requestMetrics.slowRequests && requestMetrics.slowRequests.length > 5) score -= 15;
    else if (requestMetrics.slowRequests && requestMetrics.slowRequests.length > 3) score -= 10;
    
    // Penalize for large requests
    if (requestMetrics.largeRequests && requestMetrics.largeRequests.length > 3) score -= 15;
    else if (requestMetrics.largeRequests && requestMetrics.largeRequests.length > 0) score -= 10;
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      metrics: requestMetrics,
      issues,
      score,
      url
    };
  } catch (error) {
    logger.error(`Error analyzing network requests for ${url}: ${error.message}`);
    return {
      metrics: {},
      issues: [{ 
        type: 'analysis-error', 
        description: `Error analyzing network requests: ${error.message}`,
        impact: 'unknown'
      }],
      score: 0,
      url
    };
  }
}

/**
 * Analyzes asset optimization from an accessibility perspective
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL being tested
 * @returns {Promise<Object>} - Asset optimization analysis results
 */
async function analyzeAssetOptimization(page, url) {
  try {
    // Collect metrics about assets on the page
    const metrics = await page.evaluate(() => {
      // Analyze images
      const images = Array.from(document.querySelectorAll('img'));
      const largeImages = images.filter(img => {
        // Check if image is larger than it needs to be
        const naturalSize = img.naturalWidth * img.naturalHeight;
        const displaySize = img.width * img.height;
        return naturalSize > displaySize * 2; // Image is at least 2x larger than needed
      });
      
      // Analyze videos
      const videos = Array.from(document.querySelectorAll('video'));
      const autoplaying = videos.filter(video => video.autoplay);
      const highResVideos = videos.filter(video => {
        const sources = Array.from(video.querySelectorAll('source'));
        return sources.some(source => source.src.includes('1080p') || 
                                      source.src.includes('hd') || 
                                      source.src.includes('high'));
      });
      
      // Check for responsive images
      const responsiveImages = images.filter(img => 
        img.srcset || img.sizes || img.hasAttribute('loading')
      );
      
      // Check for lazy loading
      const lazyLoadedImages = images.filter(img => img.loading === 'lazy');
      const hasLazyLoading = lazyLoadedImages.length > 0;
      
      // Check for animations
      const animations = document.querySelectorAll('.animated, [data-animation], [data-aos]');
      const hasAnimations = animations.length > 0;
      
      // Check for preloaded assets
      const preloaded = document.querySelectorAll('link[rel="preload"]');
      const hasPreloading = preloaded.length > 0;
      
      return {
        totalImages: images.length,
        largeImages: largeImages.length,
        responsiveImages: responsiveImages.length,
        lazyLoadedImages: lazyLoadedImages.length,
        totalVideos: videos.length,
        autoplayingVideos: autoplaying.length,
        highResVideos: highResVideos.length,
        hasAnimations,
        totalAnimations: animations.length,
        hasPreloading,
        totalPreloaded: preloaded.length
      };
    });
    
    // Assess issues based on metrics
    const issues = [];
    
    // Check for unoptimized images
    if (metrics.totalImages > 5 && metrics.largeImages / metrics.totalImages > 0.3) {
      issues.push({
        type: 'unoptimized-images',
        description: 'Multiple images are larger than necessary',
        value: `${metrics.largeImages}/${metrics.totalImages} (${Math.round(metrics.largeImages / metrics.totalImages * 100)}%)`,
        threshold: '30%',
        impact: 'high',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users with data limitations'],
        recommendation: 'Resize images to their display size, use responsive images with srcset, and implement modern image formats',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Check for missing responsive images
    if (metrics.totalImages > 5 && metrics.responsiveImages / metrics.totalImages < 0.5) {
      issues.push({
        type: 'missing-responsive-images',
        description: 'Limited use of responsive image techniques',
        value: `${metrics.responsiveImages}/${metrics.totalImages} (${Math.round(metrics.responsiveImages / metrics.totalImages * 100)}%)`,
        threshold: '50%',
        impact: 'medium',
        affectedGroups: ['mobile users', 'tablet users', 'users with varying screen sizes'],
        recommendation: 'Implement srcset and sizes attributes for responsive images to serve appropriately sized images',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Check for missing lazy loading
    if (metrics.totalImages > 10 && metrics.lazyLoadedImages / metrics.totalImages < 0.3) {
      issues.push({
        type: 'missing-lazy-loading',
        description: 'Limited use of lazy loading for images',
        value: `${metrics.lazyLoadedImages}/${metrics.totalImages} (${Math.round(metrics.lazyLoadedImages / metrics.totalImages * 100)}%)`,
        threshold: '30%',
        impact: 'medium',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users with cognitive disabilities'],
        recommendation: 'Implement lazy loading for images below the fold to improve initial page load time',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Check for autoplay videos
    if (metrics.autoplayingVideos > 0) {
      issues.push({
        type: 'autoplay-videos',
        description: 'Videos set to autoplay',
        value: metrics.autoplayingVideos.toString(),
        impact: 'critical',
        affectedGroups: ['users with cognitive disabilities', 'low bandwidth users', 'screen reader users'],
        recommendation: 'Avoid autoplay for videos, or ensure they have controls, are muted by default, and can be paused',
        wcagCriteria: ['2.2.2 Pause, Stop, Hide', '1.4.2 Audio Control'],
        elements: []
      });
    }
    
    // Check for high-res videos without alternatives
    if (metrics.highResVideos > 0 && metrics.highResVideos === metrics.totalVideos) {
      issues.push({
        type: 'only-highres-videos',
        description: 'Only high-resolution videos available',
        value: metrics.highResVideos.toString(),
        impact: 'high',
        affectedGroups: ['low bandwidth users', 'mobile users', 'users with data limitations'],
        recommendation: 'Provide multiple video resolutions using the source element with media queries or support adaptive streaming',
        wcagCriteria: ['2.2.1 Timing Adjustable'],
        elements: []
      });
    }
    
    // Check for excessive animations
    if (metrics.totalAnimations > 3) {
      issues.push({
        type: 'excessive-animations',
        description: 'Excessive use of animations',
        value: metrics.totalAnimations.toString(),
        threshold: '3',
        impact: 'high',
        affectedGroups: ['users with vestibular disorders', 'users with attention disorders', 'users with cognitive disabilities'],
        recommendation: 'Limit animations, respect prefers-reduced-motion, and ensure animations can be paused',
        wcagCriteria: ['2.2.2 Pause, Stop, Hide', '2.3.3 Animation from Interactions'],
        elements: []
      });
    }
    
    // Calculate score based on asset optimization
    let score = 100;
    
    // Penalize for unoptimized images
    if (metrics.totalImages > 5) {
      const unoptimizedRatio = metrics.largeImages / metrics.totalImages;
      if (unoptimizedRatio > 0.5) score -= 20;
      else if (unoptimizedRatio > 0.3) score -= 15;
      else if (unoptimizedRatio > 0.1) score -= 5;
    }
    
    // Penalize for missing responsive images
    if (metrics.totalImages > 5) {
      const responsiveRatio = metrics.responsiveImages / metrics.totalImages;
      if (responsiveRatio < 0.3) score -= 15;
      else if (responsiveRatio < 0.5) score -= 10;
      else if (responsiveRatio < 0.7) score -= 5;
    }
    
    // Penalize for missing lazy loading
    if (metrics.totalImages > 10) {
      const lazyLoadingRatio = metrics.lazyLoadedImages / metrics.totalImages;
      if (lazyLoadingRatio < 0.2) score -= 15;
      else if (lazyLoadingRatio < 0.3) score -= 10;
      else if (lazyLoadingRatio < 0.5) score -= 5;
    }
    
    // Penalize for autoplay videos
    if (metrics.autoplayingVideos > 0) {
      score -= 20;
    }
    
    // Penalize for high-res videos without alternatives
    if (metrics.highResVideos > 0 && metrics.highResVideos === metrics.totalVideos) {
      score -= 15;
    }
    
    // Penalize for excessive animations
    if (metrics.totalAnimations > 5) score -= 20;
    else if (metrics.totalAnimations > 3) score -= 10;
    
    // Bonus for using preloading
    if (metrics.hasPreloading) {
      score += 5;
    }
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
      metrics,
      issues,
      score,
      url
    };
  } catch (error) {
    logger.error(`Error analyzing asset optimization for ${url}: ${error.message}`);
    return {
      metrics: {},
      issues: [{ 
        type: 'analysis-error', 
        description: `Error analyzing asset optimization: ${error.message}`,
        impact: 'unknown'
      }],
      score: 0,
      url
    };
  }
}

module.exports = {
  analyzePageLoadPerformance,
  analyzeContentLoadingPatterns,
  analyzeProgressiveRendering,
  analyzeNetworkRequests,
  analyzeAssetOptimization
};
