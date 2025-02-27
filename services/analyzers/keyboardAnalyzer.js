const logger = require('../../utils/logger');

async function analyzeKeyboardNavigation(page, url) {
  logger.info(`Analyzing keyboard navigation for: ${url}`);
  
  try {
    const keyboardIssues = [];
    
    // Test focusable elements
    const focusableElementsData = await page.evaluate(() => {
      const focusableElements = Array.from(document.querySelectorAll(
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      ));
      
      return focusableElements.map(el => {
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
        const isDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        let tabIndex = parseInt(el.getAttribute('tabindex') || '0', 10);
        const rect = el.getBoundingClientRect();
        
        return {
          tagName: el.tagName,
          type: el.getAttribute('type'),
          hasVisibleText: (el.textContent || '').trim().length > 0,
          isVisible,
          isDisabled,
          tabIndex,
          position: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          },
          selector: getSelector(el)
        };
      });
      
      function getSelector(el) {
        if (el.id) return `#${el.id}`;
        if (el.classList && el.classList.length) return `.${Array.from(el.classList).join('.')}`;
        
        let selector = el.tagName.toLowerCase();
        if (el.name) selector += `[name="${el.name}"]`;
        
        return selector;
      }
    });
    
    // Analyze focusable elements
    for (let i = 0; i < focusableElementsData.length; i++) {
      const el = focusableElementsData[i];
      
      if (!el.isVisible || el.isDisabled) continue;
      
      if (el.tabIndex < -1) {
        keyboardIssues.push({
          id: 'keyboard-tabindex-negative',
          impact: 'critical',
          description: 'Element has a negative tabindex other than -1, which may create unpredictable tab order.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#keyboard',
          nodes: [{ target: [el.selector] }]
        });
      }
      
      if ((el.tagName === 'BUTTON' || el.tagName === 'A') && !el.hasVisibleText) {
        keyboardIssues.push({
          id: 'keyboard-interactive-no-text',
          impact: 'serious',
          description: 'Interactive element has no visible text, making it difficult for keyboard users to understand its purpose.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#name-role-value',
          nodes: [{ target: [el.selector] }]
        });
      }
    }
    
    // Test keyboard traps
    await page.keyboard.press('Tab');
    let lastFocusedElement = null;
    let trapCount = 0;
    
    for (let i = 0; i < Math.min(30, focusableElementsData.length); i++) {
      const currentFocused = await page.evaluate(() => {
        return document.activeElement ? document.activeElement.outerHTML.substring(0, 100) : null;
      });
      
      if (currentFocused === lastFocusedElement && lastFocusedElement !== null) {
        trapCount++;
        if (trapCount >= 2) {
          keyboardIssues.push({
            id: 'keyboard-trap',
            impact: 'critical',
            description: 'Possible keyboard trap detected: Focus did not move after pressing Tab multiple times.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#no-keyboard-trap',
            nodes: [{ target: ['document'] }]
          });
          break;
        }
      } else {
        trapCount = 0;
      }
      
      lastFocusedElement = currentFocused;
      await page.keyboard.press('Tab');
    }
    
    // Reset focus
    await page.evaluate(() => document.activeElement.blur());
    
    return {
      url,
      violations: keyboardIssues,
      violationCounts: {
        total: keyboardIssues.length,
        critical: keyboardIssues.filter(i => i.impact === 'critical').length,
        warning: keyboardIssues.filter(i => i.impact === 'serious' || i.impact === 'moderate').length,
        info: keyboardIssues.filter(i => i.impact === 'minor').length
      }
    };
  } catch (error) {
    logger.error(`Error analyzing keyboard navigation on ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

module.exports = { analyzeKeyboardNavigation };
