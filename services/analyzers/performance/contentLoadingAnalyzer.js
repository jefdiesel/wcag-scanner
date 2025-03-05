const logger = require('../../../utils/logger');

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

module.exports = {
  analyzeContentLoadingPatterns
};
