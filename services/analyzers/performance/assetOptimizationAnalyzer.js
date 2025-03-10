const logger = require('../../../utils/logger');

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
  analyzeAssetOptimization
};
