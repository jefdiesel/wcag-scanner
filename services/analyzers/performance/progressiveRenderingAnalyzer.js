const logger = require('../../../utils/logger');

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

module.exports = {
  analyzeProgressiveRendering
};
