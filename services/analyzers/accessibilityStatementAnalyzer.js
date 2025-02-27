const logger = require('../../utils/logger');

async function checkAccessibilityStatement(page, url) {
  logger.info(`Checking for accessibility statement on: ${url}`);
  
  try {
    const statementResult = await page.evaluate(() => {
      const keywords = [
        'accessibility',
        'accessible',
        'ada',
        'wcag',
        'disability',
        'disabilities',
        'accommodations'
      ];
      
      const links = Array.from(document.querySelectorAll('a'));
      const footerLinks = Array.from(document.querySelectorAll('footer a, [role="contentinfo"] a'));
      
      const allLinks = [...footerLinks, ...links];
      
      const potentialStatementLinks = allLinks.filter(link => {
        const text = (link.textContent || '').toLowerCase();
        const href = (link.getAttribute('href') || '').toLowerCase();
        
        return keywords.some(keyword => 
          text.includes(keyword) || href.includes(keyword)
        );
      });
      
      if (potentialStatementLinks.length > 0) {
        return {
          found: true,
          links: potentialStatementLinks.map(link => ({
            text: link.textContent.trim(),
            href: link.getAttribute('href')
          }))
        };
      }
      
      const pageContent = document.body.textContent.toLowerCase();
      const hasAccessibilityContent = keywords.some(keyword => pageContent.includes(keyword));
      
      return {
        found: hasAccessibilityContent,
        hasKeywords: hasAccessibilityContent
      };
    });
    
    let violations = [];
    if (!statementResult.found) {
      violations.push({
        id: 'accessibility-statement-missing',
        impact: 'moderate',
        description: 'No accessibility statement found. Websites should provide information about their accessibility features and contact information for users with disabilities.',
        helpUrl: 'https://www.w3.org/WAI/planning/statements/',
        nodes: [{ target: ['document'] }]
      });
    } else if (statementResult.links && statementResult.links.length > 0) {
      violations.push({
        id: 'accessibility-statement-verify',
        impact: 'minor',
        description: 'Potential accessibility statement found. Verify that it includes contact information, conformance level claims, and known limitations.',
        helpUrl: 'https://www.w3.org/WAI/planning/statements/',
        nodes: [{ target: statementResult.links.map(l => l.href) }]
      });
    }
    
    return {
      url,
      violations,
      violationCounts: {
        total: violations.length,
        critical: 0,
        warning: violations.filter(i => i.impact === 'moderate').length,
        info: violations.filter(i => i.impact === 'minor').length
      }
    };
  } catch (error) {
    logger.error(`Error checking accessibility statement on ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

module.exports = { checkAccessibilityStatement };
