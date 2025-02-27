const logger = require('../../utils/logger');

async function identifyManualReviewItems(page, url) {
  logger.info(`Identifying elements requiring manual review for: ${url}`);
  
  try {
    const manualReviewItems = await page.evaluate(() => {
      const items = [];
      
      // Check CAPTCHA implementations
      const captchas = Array.from(document.querySelectorAll('[class*="captcha"],[id*="captcha"]'));
      captchas.forEach((captcha, index) => {
        items.push({
          id: 'manual-review-captcha',
          impact: 'moderate',
          description: 'CAPTCHA detected. Verify that an accessible alternative is provided.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#captcha',
          nodes: [{ target: [`captcha-${index}`] }],
          element: captcha.outerHTML.substring(0, 200)
        });
      });
      
      // Check complex data tables
      const tables = Array.from(document.querySelectorAll('table'));
      tables.forEach((table, index) => {
        const hasMultipleHeaderRows = table.querySelectorAll('thead tr').length > 1;
        const hasNestedTables = table.querySelectorAll('table').length > 0;
        
        if (hasMultipleHeaderRows || hasNestedTables) {
          items.push({
            id: 'manual-review-complex-table',
            impact: 'moderate',
            description: 'Complex data table detected. Verify that proper header associations are made.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#info-and-relationships',
            nodes: [{ target: [`table-${index}`] }],
            element: table.outerHTML.substring(0, 200)
          });
        }
      });
      
      // Check custom carousels and sliders
      const carousels = Array.from(document.querySelectorAll(
        '[class*="carousel"],[class*="slider"],[id*="carousel"],[id*="slider"]'
      ));
      carousels.forEach((carousel, index) => {
        items.push({
          id: 'manual-review-carousel',
          impact: 'moderate',
          description: 'Carousel/slider detected. Check keyboard accessibility and auto-rotation controls.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#pause-stop-hide',
          nodes: [{ target: [`carousel-${index}`] }],
          element: carousel.outerHTML.substring(0, 200)
        });
      });
      
      // Check custom dropdown menus
      const dropdowns = Array.from(document.querySelectorAll(
        '[class*="dropdown"],[id*="dropdown"],[aria-haspopup="true"]'
      )).filter(el => el.tagName !== 'SELECT');
      
      dropdowns.forEach((dropdown, index) => {
        items.push({
          id: 'manual-review-dropdown',
          impact: 'moderate',
          description: 'Custom dropdown detected. Verify keyboard accessibility and ARIA attributes.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#keyboard',
          nodes: [{ target: [`dropdown-${index}`] }],
          element: dropdown.outerHTML.substring(0, 200)
        });
      });
      
      // Check SVG content
      const svgs = Array.from(document.querySelectorAll('svg'));
      svgs.forEach((svg, index) => {
        const hasTitleOrDesc = svg.querySelector('title, desc');
        if (!hasTitleOrDesc) {
          items.push({
            id: 'manual-review-svg',
            impact: 'moderate',
            description: 'SVG lacks title or description. Verify that it is properly described for screen readers.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#non-text-content',
            nodes: [{ target: [`svg-${index}`] }],
            element: svg.outerHTML.substring(0, 200)
          });
        }
      });
      
      // Check for drag-and-drop functionality
      const draggables = Array.from(document.querySelectorAll('[draggable="true"],[class*="drag"],[id*="drag"]'));
      draggables.forEach((draggable, index) => {
        items.push({
          id: 'manual-review-drag-drop',
          impact: 'moderate',
          description: 'Drag-and-drop functionality detected. Verify keyboard alternative is provided.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#keyboard',
          nodes: [{ target: [`draggable-${index}`] }],
          element: draggable.outerHTML.substring(0, 200)
        });
      });
      
      return items;
    });
    
    return {
      url,
      violations: manualReviewItems,
      violationCounts: {
        total: manualReviewItems.length,
        critical: 0,
        warning: manualReviewItems.filter(i => i.impact === 'moderate').length,
        info: manualReviewItems.filter(i => i.impact === 'minor').length
      }
    };
  } catch (error) {
    logger.error(`Error identifying manual review items on ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

module.exports = { identifyManualReviewItems };
