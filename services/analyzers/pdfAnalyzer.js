const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const logger = require('../../utils/logger');

async function analyzePdf(pdfUrl, browser) {
  logger.info(`Analyzing PDF accessibility for: ${pdfUrl}`);
  try {
    const page = await browser.newPage();
    const response = await page.goto(pdfUrl);
    const buffer = await response.buffer();
    
    const tempPdfPath = path.join(__dirname, '../../temp', `temp-${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPath, buffer);
    
    const pdfDoc = await PDFDocument.load(buffer);
    const issues = [];
    
    const catalog = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root);
    const markInfo = catalog.get('MarkInfo');
    const isTagged = markInfo && markInfo.get('Marked') === true;
    
    if (!isTagged) {
      issues.push({
        id: 'pdf-not-tagged',
        impact: 'critical',
        description: 'PDF is not tagged. Tagged PDFs are required for screen readers.',
        helpUrl: 'https://www.w3.org/TR/WCAG21/#pdf-tags',
        nodes: [{ target: [pdfUrl] }]
      });
    }
    
    const title = catalog.get('Title');
    if (!title) {
      issues.push({
        id: 'pdf-no-title',
        impact: 'moderate',
        description: 'PDF has no title. Documents should have descriptive titles.',
        helpUrl: 'https://www.w3.org/TR/WCAG21/#pdf-title',
        nodes: [{ target: [pdfUrl] }]
      });
    }
    
    const lang = catalog.get('Lang');
    if (!lang) {
      issues.push({
        id: 'pdf-no-language',
        impact: 'moderate',
        description: 'PDF has no language specified. Documents should specify language.',
        helpUrl: 'https://www.w3.org/TR/WCAG21/#pdf-language',
        nodes: [{ target: [pdfUrl] }]
      });
    }
    
    // Clean up temp file
    fs.unlinkSync(tempPdfPath);
    
    return {
      url: pdfUrl,
      violations: issues,
      violationCounts: {
        total: issues.length,
        critical: issues.filter(i => i.impact === 'critical').length,
        warning: issues.filter(i => i.impact === 'moderate').length,
        info: issues.filter(i => i.impact === 'minor').length
      }
    };
  } catch (error) {
    logger.error(`Error analyzing PDF ${pdfUrl}: ${error.message}`);
    return {
      url: pdfUrl,
      error: error.message,
      violations: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

module.exports = { analyzePdf };
