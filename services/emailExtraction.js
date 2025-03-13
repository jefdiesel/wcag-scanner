const logger = require('../utils/logger');

/**
 * Extract emails from a page
 * @param {import('playwright').Page} page - Playwright page
 * @returns {Promise<string[]>} - Array of unique emails found
 */
async function extractEmails(page) {
  try {
    // Extract emails from href="mailto:" links
    const mailtoEmails = await page.$$eval('a[href^="mailto:"]', (links) => {
      return links.map(link => {
        const href = link.getAttribute('href');
        if (!href) return null;
        // Remove "mailto:" and extract just the email
        const email = href.replace(/^mailto:/, '').split('?')[0].trim();
        return email && email.includes('@') ? email.toLowerCase() : null;
      }).filter(email => email !== null);
    });

    // Extract emails from page content using regex
    const contentEmails = await page.evaluate(() => {
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const bodyText = document.body.innerText;
      const matches = bodyText.match(emailRegex) || [];
      return matches.map(email => email.toLowerCase());
    });

    // Combine and deduplicate emails
    const allEmails = [...mailtoEmails, ...contentEmails];
    return [...new Set(allEmails)];
  } catch (error) {
    logger.error(`Error extracting emails: ${error.message}`);
    return [];
  }
}

module.exports = { extractEmails };
