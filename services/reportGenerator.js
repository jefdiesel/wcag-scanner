const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getAsync, allAsync } = require('../db/db');
const { sanitizeUrlForFilename, safeJsonParse, getReportPaths } = require('../utils/helpers');
const logger = require('../utils/logger');
const { REPORT_DIR } = require('../config/config');

/**
 * Generate a concise, optimized PDF (executive summary)
 * @param {string} scanId - Scan ID
 * @param {string} url - Website URL
 * @returns {Promise<string|null>} - Path to generated PDF or null if failed
 */
async function generatePDF(scanId, url) {
  logger.info(`Auto-generating PDF for scan ${scanId} of ${url}`);
  
  try {
    // Get results from database
    const rows = await allAsync(
      'SELECT url, violations, links, status FROM scan_results WHERE scan_id = ? ORDER BY scanned_at',
      [scanId]
    );
    
    if (rows.length === 0) {
      logger.warn(`No results found for PDF generation for scan ${scanId}`);
      return null;
    }

    // Parse results
    const results = rows.map(row => {
      try {
        return {
          page: row.url,
          violations: safeJsonParse(row.violations, {}),
          links: safeJsonParse(row.links, []),
          status: row.status || null
        };
      } catch (parseErr) {
        logger.error(`Failed to parse JSON for row ${row.url}: ${parseErr.message}`);
        return {
          page: row.url,
          violations: {},
          links: [],
          status: row.status || null
        };
      }
    });

    // Initialize issue counters and categories
    const issueCounters = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      levels: {
        'Level A': { total: 0, critical: 0, warning: 0, info: 0 },
        'Level AA': { total: 0, critical: 0, warning: 0, info: 0 },
        'Level AAA': { total: 0, critical: 0, warning: 0, info: 0 }
      },
      categories: {
        Perceivable: { total: 0, critical: 0, warning: 0, info: 0 },
        Operable: { total: 0, critical: 0, warning: 0, info: 0 },
        Understandable: { total: 0, critical: 0, warning: 0, info: 0 },
        Robust: { total: 0, critical: 0, warning: 0, info: 0 },
        Error: { total: 0, critical: 0, warning: 0, info: 0 }
      }
    };

    // Process violations to categorize issues
    results.forEach(result => {
      Object.values(result.violations).forEach(violations => {
        if (!Array.isArray(violations)) {
          return;
        }
        
        violations.forEach(violation => {
          try {
            if (!violation) {
              return;
            }
            
            issueCounters.total++;
            const severity = violation.impact || 'info';
            
            // Count by severity
            if (severity === 'critical') issueCounters.critical++;
            else if (severity === 'serious' || severity === 'warning') issueCounters.warning++;
            else issueCounters.info++;

            // Map WCAG tags to levels and count
            let level = 'Level AA'; // Default to AA
            if (violation.tags && Array.isArray(violation.tags)) {
              if (violation.tags.includes('wcag2a')) level = 'Level A';
              else if (violation.tags.includes('wcag2aaa')) level = 'Level AAA';
              
              issueCounters.levels[level].total++;
              if (severity === 'critical') issueCounters.levels[level].critical++;
              else if (severity === 'serious' || severity === 'warning') issueCounters.levels[level].warning++;
              else issueCounters.levels[level].info++;

              // Map to WCAG principle categories
              let category = 'Error'; // Default
              if (violation.tags.includes('cat.text-alternatives') || 
                  violation.tags.includes('cat.sensory-and-visual-cues')) {
                category = 'Perceivable';
              } else if (violation.tags.includes('cat.keyboard') || 
                         violation.tags.includes('cat.name-role-value') || 
                         violation.tags.includes('cat.time-and-media')) {
                category = 'Operable';
              } else if (violation.tags.includes('cat.language') || 
                         violation.tags.includes('cat.form') || 
                         violation.tags.includes('cat.parsing')) {
                category = 'Understandable';
              } else if (violation.tags.includes('cat.structure') || 
                         violation.tags.includes('cat.aria')) {
                category = 'Robust';
              }
              
              issueCounters.categories[category].total++;
              if (severity === 'critical') issueCounters.categories[category].critical++;
              else if (severity === 'serious' || severity === 'warning') issueCounters.categories[category].warning++;
              else issueCounters.categories[category].info++;
            }
          } catch (error) {
            logger.error(`Error processing violation: ${error.message}`);
          }
        });
      });
    });

    // Calculate compliance score
    const complianceScore = issueCounters.total > 0 
      ? ((issueCounters.total - issueCounters.critical) / issueCounters.total * 100).toFixed(1) 
      : '100.0';

    // Get report paths
    const { reportDir, pdfPath } = getReportPaths(url, REPORT_DIR);
    
    // Create report directory if it doesn't exist
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Create PDF document
    const doc = new PDFDocument({
      autoFirstPage: true,
      compress: true,
      size: 'letter',
      margin: 50,
      info: {
        Title: `WCAG Accessibility Audit - ${new URL(url).hostname}`,
        Author: 'WCAG Scanner',
        Subject: 'Web Accessibility Audit Summary',
        Keywords: 'WCAG, accessibility, audit, summary'
      }
    });

    // Pipe to file
    const pdfStream = fs.createWriteStream(pdfPath);
    pdfStream.on('finish', () => {
      logger.info(`PDF saved to ${pdfPath}`);
    });
    
    doc.pipe(pdfStream);

    // Title and basic info
    doc.fontSize(18)
       .font('Helvetica-Bold')
       .fillColor('#000000')
       .text('Web Accessibility Audit Report', { align: 'center' })
       .fontSize(14)
       .text(`for ${new URL(url).hostname} - Report Generated by www.a11yscan.xyz`, { align: 'center' })
       .moveDown()
       .fontSize(10)
       .font('Helvetica')
       .text(`Generated on ${new Date().toLocaleDateString()}`)
       .text(`Website: ${url}`)
       .moveDown();

    // Executive Summary
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('Executive Summary')
       .moveDown(0.5)
       .fontSize(12)
       .font('Helvetica')
       .text(`Overall Compliance Score: ${complianceScore}%`)
       .moveDown(0.5);

    // Severity table - optimized structure
    doc.font('Helvetica-Bold')
       .text('Issue Severity Summary:');
    
    // Table for severity counts
    let tableTop = doc.y + 5;
    let tableX = 50;
    const cellPadding = 5;
    const columnWidths = [150, 50];
    
    // Draw headers
    doc.fillColor('#f0f0f0')
       .rect(tableX, tableTop, columnWidths[0] + columnWidths[1], 20)
       .fill();
    
    doc.fillColor('#000000')
       .font('Helvetica-Bold')
       .text('Severity', tableX + cellPadding, tableTop + cellPadding, { width: columnWidths[0] })
       .text('Count', tableX + columnWidths[0] + cellPadding, tableTop + cellPadding, { width: columnWidths[1] });
    
    // Draw rows
    let rowY = tableTop + 20;
    
    // Critical row
    doc.fillColor('#f8d7da')
       .rect(tableX, rowY, columnWidths[0] + columnWidths[1], 20)
       .fill();
    
    doc.fillColor('#721c24')
       .font('Helvetica')
       .text('Critical Issues', tableX + cellPadding, rowY + cellPadding, { width: columnWidths[0] })
       .text(issueCounters.critical.toString(), tableX + columnWidths[0] + cellPadding, rowY + cellPadding, { width: columnWidths[1] });
    
    // Warning row
    rowY += 20;
    doc.fillColor('#fff3cd')
       .rect(tableX, rowY, columnWidths[0] + columnWidths[1], 20)
       .fill();
    
    doc.fillColor('#856404')
       .text('Warning Issues', tableX + cellPadding, rowY + cellPadding, { width: columnWidths[0] })
       .text(issueCounters.warning.toString(), tableX + columnWidths[0] + cellPadding, rowY + cellPadding, { width: columnWidths[1] });
    
    // Info row
    rowY += 20;
    doc.fillColor('#d1ecf1')
       .rect(tableX, rowY, columnWidths[0] + columnWidths[1], 20)
       .fill();
    
    doc.fillColor('#0c5460')
       .text('Information Issues', tableX + cellPadding, rowY + cellPadding, { width: columnWidths[0] })
       .text(issueCounters.info.toString(), tableX + columnWidths[0] + cellPadding, rowY + cellPadding, { width: columnWidths[1] });
    
    // Total row
    rowY += 20;
    doc.fillColor('#f0f0f0')
       .rect(tableX, rowY, columnWidths[0] + columnWidths[1], 20)
       .fill();
    
    doc.fillColor('#000000')
       .font('Helvetica-Bold')
       .text('Total Issues', tableX + cellPadding, rowY + cellPadding, { width: columnWidths[0] })
       .text(issueCounters.total.toString(), tableX + columnWidths[0] + cellPadding, rowY + cellPadding, { width: columnWidths[1] });
    
    doc.moveDown(2);

    // WCAG Level Analysis
    doc.font('Helvetica-Bold')
       .text('WCAG Level Analysis:')
       .moveDown(0.5);
    
    // WCAG Level Analysis table
    tableTop = doc.y;
    const wcagColWidths = [80, 80, 80, 80, 80];
    
    // Draw header
    doc.fillColor('#f0f0f0')
       .rect(tableX, tableTop, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .font('Helvetica-Bold')
       .fontSize(10);
    
    // Header row
    doc.text('Level', tableX + cellPadding, tableTop + cellPadding, { width: wcagColWidths[0] })
       .text('Total', tableX + wcagColWidths[0] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[1] })
       .text('Critical', tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[2] })
       .text('Warning', tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[3] })
       .text('Info', tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[4] });
    
    // Data rows
    rowY = tableTop + 20;
    doc.font('Helvetica').fontSize(10);
    
    // Level A row
    doc.fillColor('#ffffff')
       .rect(tableX, rowY, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .text('Level A', tableX + cellPadding, rowY + cellPadding, { width: wcagColWidths[0] })
       .text(issueCounters.levels['Level A'].total.toString(), tableX + wcagColWidths[0] + cellPadding, rowY + cellPadding, { width: wcagColWidths[1] })
       .text(issueCounters.levels['Level A'].critical.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, rowY + cellPadding, { width: wcagColWidths[2] })
       .text(issueCounters.levels['Level A'].warning.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, rowY + cellPadding, { width: wcagColWidths[3] })
       .text(issueCounters.levels['Level A'].info.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, rowY + cellPadding, { width: wcagColWidths[4] });
    
    // Level AA row
    rowY += 20;
    doc.fillColor('#f5f5f5')
       .rect(tableX, rowY, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .text('Level AA', tableX + cellPadding, rowY + cellPadding, { width: wcagColWidths[0] })
       .text(issueCounters.levels['Level AA'].total.toString(), tableX + wcagColWidths[0] + cellPadding, rowY + cellPadding, { width: wcagColWidths[1] })
       .text(issueCounters.levels['Level AA'].critical.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, rowY + cellPadding, { width: wcagColWidths[2] })
       .text(issueCounters.levels['Level AA'].warning.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, rowY + cellPadding, { width: wcagColWidths[3] })
       .text(issueCounters.levels['Level AA'].info.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, rowY + cellPadding, { width: wcagColWidths[4] });
    
    // Level AAA row
    rowY += 20;
    doc.fillColor('#ffffff')
       .rect(tableX, rowY, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .text('Level AAA', tableX + cellPadding, rowY + cellPadding, { width: wcagColWidths[0] })
       .text(issueCounters.levels['Level AAA'].total.toString(), tableX + wcagColWidths[0] + cellPadding, rowY + cellPadding, { width: wcagColWidths[1] })
       .text(issueCounters.levels['Level AAA'].critical.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, rowY + cellPadding, { width: wcagColWidths[2] })
       .text(issueCounters.levels['Level AAA'].warning.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, rowY + cellPadding, { width: wcagColWidths[3] })
       .text(issueCounters.levels['Level AAA'].info.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, rowY + cellPadding, { width: wcagColWidths[4] });
    
    // Total row
    rowY += 20;
    doc.fillColor('#f0f0f0')
       .rect(tableX, rowY, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .font('Helvetica-Bold')
       .text('TOTAL', tableX + cellPadding, rowY + cellPadding, { width: wcagColWidths[0] })
       .text(issueCounters.total.toString(), tableX + wcagColWidths[0] + cellPadding, rowY + cellPadding, { width: wcagColWidths[1] })
       .text(issueCounters.critical.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, rowY + cellPadding, { width: wcagColWidths[2] })
       .text(issueCounters.warning.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, rowY + cellPadding, { width: wcagColWidths[3] })
       .text(issueCounters.info.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, rowY + cellPadding, { width: wcagColWidths[4] });

    doc.moveDown(1.5);

    // Category Analysis
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .text('WCAG Category Analysis:')
       .moveDown(0.5);
    
    // Category Analysis table
    tableTop = doc.y;
    
    // Draw header
    doc.fillColor('#f0f0f0')
       .rect(tableX, tableTop, wcagColWidths.reduce((a, b) => a + b, 0), 20)
       .fill();
    
    doc.fillColor('#000000')
       .font('Helvetica-Bold')
       .fontSize(10);
    
    // Header row
    doc.text('Category', tableX + cellPadding, tableTop + cellPadding, { width: wcagColWidths[0] })
       .text('Total', tableX + wcagColWidths[0] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[1] })
       .text('Critical', tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[2] })
       .text('Warning', tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[3] })
       .text('Info', tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, tableTop + cellPadding, { width: wcagColWidths[4] });
    
    // Data rows for categories
    rowY = tableTop + 20;
    doc.font('Helvetica').fontSize(10);
    
    // Calculate alternating row colors
    let categoryRowCount = 0;
    for (const category of ['Perceivable', 'Operable', 'Understandable', 'Robust', 'Error']) {
      doc.fillColor(categoryRowCount % 2 === 0 ? '#ffffff' : '#f5f5f5')
         .rect(tableX, rowY, wcagColWidths.reduce((a, b) => a + b, 0), 20)
         .fill();
      
      doc.fillColor('#000000')
         .text(category, tableX + cellPadding, rowY + cellPadding, { width: wcagColWidths[0] })
         .text(issueCounters.categories[category].total.toString(), tableX + wcagColWidths[0] + cellPadding, rowY + cellPadding, { width: wcagColWidths[1] })
         .text(issueCounters.categories[category].critical.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + cellPadding, rowY + cellPadding, { width: wcagColWidths[2] })
         .text(issueCounters.categories[category].warning.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + cellPadding, rowY + cellPadding, { width: wcagColWidths[3] })
         .text(issueCounters.categories[category].info.toString(), tableX + wcagColWidths[0] + wcagColWidths[1] + wcagColWidths[2] + wcagColWidths[3] + cellPadding, rowY + cellPadding, { width: wcagColWidths[4] });
      
      rowY += 20;
      categoryRowCount++;
    }

    // Add a footer note
    doc.moveDown(2);
    doc.fontSize(9)
       .fillColor('#666666')
       .text('For detailed information on specific issues, please refer to the accompanying CSV report.');

    // Finalize the PDF
    doc.end();
    
    return pdfPath;
  } catch (error) {
    logger.error(`PDF generation failed for scan ${scanId}: ${error.stack}`);
    return null;
  }
}

/**
 * Generate a detailed CSV with all issues
 * @param {string} scanId - Scan ID
 * @param {string} url - Website URL
 * @returns {Promise<string|null>} - Path to generated CSV or null if failed
 */
async function generateCSV(scanId, url) {
  logger.info(`Generating detailed CSV for scan ${scanId} of ${url}`);
  
  try {
    // Get results from database
    const rows = await allAsync(
      'SELECT url, violations, links, status FROM scan_results WHERE scan_id = ? ORDER BY scanned_at',
      [scanId]
    );
    
    if (rows.length === 0) {
      logger.warn(`No results found for CSV generation for scan ${scanId}`);
      return null;
    }

    // Parse results
    const results = rows.map(row => {
      try {
        return {
          page: row.url,
          violations: safeJsonParse(row.violations, {}),
          links: safeJsonParse(row.links, []),
          status: row.status || null
        };
      } catch (parseErr) {
        logger.error(`Failed to parse JSON for row ${row.url}: ${parseErr.message}`);
        return {
          page: row.url,
          violations: {},
          links: [],
          status: row.status || null
        };
      }
    });

    // Get report paths
    const { reportDir, csvPath } = getReportPaths(url, REPORT_DIR);
    
    // Create report directory if it doesn't exist
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Create the CSV file
    const csvStream = fs.createWriteStream(csvPath);
    
    // Write CSV header - expanded to include detailed issue info
    csvStream.write('Page URL,Status,Issue Type,WCAG Level,Category,Description,Impact,Node\n');
    
    // Extract and write detailed issues 
    results.forEach(result => {
      const pageUrl = result.page.replace(/"/g, '""'); // Escape quotes
      const status = result.status || 'N/A';
      
      let hasViolations = false;
      
      // Process all violation categories
      Object.entries(result.violations).forEach(([issueType, violations]) => {
        if (Array.isArray(violations)) {
          violations.forEach(violation => {
            if (!violation) return;
            
            hasViolations = true;
            
            // Determine WCAG level
            let wcagLevel = 'AA'; // Default
            if (violation.tags && Array.isArray(violation.tags)) {
              if (violation.tags.includes('wcag2a')) wcagLevel = 'A';
              else if (violation.tags.includes('wcag2aaa')) wcagLevel = 'AAA';
            }
            
            // Determine category
            let category = 'Error'; // Default
            if (violation.tags && Array.isArray(violation.tags)) {
              if (violation.tags.includes('cat.text-alternatives') || 
                  violation.tags.includes('cat.sensory-and-visual-cues')) {
                category = 'Perceivable';
              } else if (violation.tags.includes('cat.keyboard') || 
                        violation.tags.includes('cat.name-role-value') || 
                        violation.tags.includes('cat.time-and-media')) {
                category = 'Operable';
              } else if (violation.tags.includes('cat.language') || 
                        violation.tags.includes('cat.form') || 
                        violation.tags.includes('cat.parsing')) {
                category = 'Understandable';
              } else if (violation.tags.includes('cat.structure') || 
                        violation.tags.includes('cat.aria')) {
                category = 'Robust';
              }
            }
            
            // Escape and format description
            const description = (violation.description || 'No description').replace(/"/g, '""').replace(/,/g, ';');
            const impact = violation.impact || 'info';
            
            // Get node information if available
            let nodeInfo = 'N/A';
            if (violation.nodes && Array.isArray(violation.nodes) && violation.nodes.length > 0) {
              const node = violation.nodes[0];
              if (node.target && Array.isArray(node.target) && node.target.length > 0) {
                nodeInfo = node.target[0].toString().replace(/"/g, '""').replace(/,/g, ';').substring(0, 100);
                if (nodeInfo.length >= 100) nodeInfo += '...';
              }
            }
            
            // Write the detailed issue row
            csvStream.write(`"${pageUrl}",${status},"${issueType}",Level ${wcagLevel},${category},"${description}",${impact},"${nodeInfo}"\n`);
          });
        }
      });
      
      // If page has no violations, still include a row
      if (!hasViolations) {
        csvStream.write(`"${pageUrl}",${status},"No Issues",N/A,N/A,"No accessibility issues detected",none,N/A\n`);
      }
    });
    
    // Close the stream
    csvStream.end();
    
    logger.info(`Detailed CSV saved to ${csvPath}`);
    return csvPath;
  } catch (error) {
    logger.error(`CSV generation failed for scan ${scanId}: ${error.stack}`);
    return null;
  }
}

module.exports = {
  generatePDF,
  generateCSV
};
