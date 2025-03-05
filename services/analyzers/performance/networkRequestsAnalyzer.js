const logger = require('../../../utils/logger');

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

module.exports = {
  analyzeNetworkRequests
};
