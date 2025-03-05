const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getAsync, allAsync } = require('../db/db');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const logger = require('../utils/logger');
const { REPORT_DIR } = require('../config/config');

/**
 * Helper function to safely parse JSON with a fallback
 * @param {string} jsonString - JSON string to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @returns {*} - Parsed object or fallback value
 */
function safeJsonParse(jsonString, fallback) {
  try {
    return jsonString ? JSON.parse(jsonString) : fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * Get the report file paths for a given scan
 * @param {string} url - Original URL
 * @param {string} reportsDir - Reports directory path
 * @returns {Object} - Object with paths for report directory, PDF and CSV reports
 */
function getReportPaths(url, reportsDir) {
  const sanitizedUrl = sanitizeUrlForFilename(url);
  const reportDir = path.join(reportsDir, sanitizedUrl);
  
  return {
    reportDir,
    pdfPath: path.join(reportDir, `${sanitizedUrl}.pdf`),
    csvPath: path.join(reportDir, `${sanitizedUrl}.csv`)
  };
}

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

    // Parse results - using the same counting logic as in the UI
    const results = rows.map(row => {
      try {
        // Parse violations JSON (handle different formats)
        const violationsData = safeJsonParse(row.violations, {});
        
        // Extract violations array - could be in different formats
        let violations = [];
        
        if (Array.isArray(violationsData)) {
          violations = violationsData;
        } else if (violationsData.violations && Array.isArray(violationsData.violations)) {
          violations = violationsData.violations;
        } else if (typeof violationsData === 'object' && violationsData !== null) {
          if (violationsData.violationCounts) {
            // If we already have the counts, use them directly
            return {
              page: row.url,
              violationCounts: violationsData.violationCounts,
              violations: violationsData.violations || [],
              links: safeJsonParse(row.links, []),
              status: row.status || null
            };
          }
          // Otherwise, try to extract violations from the object
          violations = Object.values(violationsData).flat().filter(Array.isArray);
        }
        
        // Count violations using the same logic as UI - count each node occurrence
        const violationCounts = { total: 0, critical: 0, warning: 0, info: 0 };
        
        violations.forEach(violation => {
          const nodeCount = violation.nodes?.length || 0;
          violationCounts.total += nodeCount;
          
          // Map axe impact levels to our severity levels
          switch (violation.impact) {
            case 'critical':
            case 'serious':
              violationCounts.critical += nodeCount;
              break;
            case 'moderate':
            case 'minor':
              violationCounts.warning += nodeCount;
              break;
            default:
              violationCounts.info += nodeCount;
              break;
          }
        });
        
        return {
          page: row.url,
          violationCounts,
          violations,
          links: safeJsonParse(row.links, []),
          status: row.status || null
        };
      } catch (parseErr) {
        logger.error(`Failed to parse JSON for row ${row.url}: ${parseErr.message}`);
        return {
          page: row.url,
          violationCounts: { total: 0, critical: 0, warning: 0, info: 0 },
          violations: [],
          links: [],
          status: row.status || null
        };
      }
    });

  // Get total pages scanned (direct count from our results)
  const totalPagesScanned = rows.length;
  
  // Extract and count unique URLs from all links arrays to get total pages found
  let allFoundUrls = new Set();
  
  // Process each page's links to count total unique URLs found
  rows.forEach(row => {
    const links = safeJsonParse(row.links, []);
    links.forEach(link => {
      if (link && typeof link === 'string') {
        allFoundUrls.add(link);
      }
    });
    // Also add the scanned URL itself
    allFoundUrls.add(row.url);
  });
  
  const totalPagesFound = allFoundUrls.size;

    // Initialize issue counters and categories using the same counting logic as the UI
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

    // Directly use violation counts from the parsed results
    results.forEach(result => {
      // Add to total counts
      issueCounters.total += result.violationCounts.total;
      issueCounters.critical += result.violationCounts.critical;
      issueCounters.warning += result.violationCounts.warning;
      issueCounters.info += result.violationCounts.info;
      
      // Process individual violations to categorize by level and category
      result.violations.forEach(violation => {
        if (!violation) return;
        
        const nodeCount = violation.nodes?.length || 0;
        if (nodeCount === 0) return;
        
        // Determine severity
        let severity = 'info';
        if (violation.impact === 'critical' || violation.impact === 'serious') {
          severity = 'critical';
        } else if (violation.impact === 'moderate' || violation.impact === 'minor') {
          severity = 'warning';
        }
        
        // Map WCAG tags to levels and count
        let level = 'Level AA'; // Default to AA
        if (violation.tags && Array.isArray(violation.tags)) {
          if (violation.tags.includes('wcag2a')) level = 'Level A';
          else if (violation.tags.includes('wcag2aaa')) level = 'Level AAA';
          
          issueCounters.levels[level].total += nodeCount;
          if (severity === 'critical') issueCounters.levels[level].critical += nodeCount;
          else if (severity === 'warning') issueCounters.levels[level].warning += nodeCount;
          else issueCounters.levels[level].info += nodeCount;

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
          
          issueCounters.categories[category].total += nodeCount;
          if (severity === 'critical') issueCounters.categories[category].critical += nodeCount;
          else if (severity === 'warning') issueCounters.categories[category].warning += nodeCount;
          else issueCounters.categories[category].info += nodeCount;
        }
      });
    });

    // No longer calculating a compliance score that could be misleading

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
       .text(`This report details accessibility issues that require attention.`)
       .moveDown(0.2)
       .text(`Critical issues: ${issueCounters.critical} (${(issueCounters.critical/issueCounters.total*100).toFixed(1)}% of total)`)
       .text(`Warning issues: ${issueCounters.warning} (${(issueCounters.warning/issueCounters.total*100).toFixed(1)}% of total)`)
       .moveDown(0.5);

// Page Statistics Section
  doc.fontSize(14)
     .font('Helvetica-Bold')
     .text('Page Statistics')
     .moveDown(0.5)
     .fontSize(12)
     .font('Helvetica')
     .text(`Total Pages Discovered: ${totalPagesFound}`)
     .text(`Total Pages Scanned: ${totalPagesScanned}`)
     .text(`Coverage: ${Math.round((totalPagesScanned / Math.max(totalPagesFound, 1)) * 100)}%`)
     .moveDown(1);

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

    // Sanitize URL for folder and file naming
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
    rows.forEach(row => {
      const pageUrl = row.url.replace(/"/g, '""'); // Escape quotes
      const status = row.status || 'N/A';
      
      // Parse violations data
      const violationsData = safeJsonParse(row.violations, {});
      let violations = [];
      
      // Extract violations array depending on format
      if (Array.isArray(violationsData)) {
        violations = violationsData;
      } else if (violationsData.violations && Array.isArray(violationsData.violations)) {
        violations = violationsData.violations;
      } else if (typeof violationsData === 'object' && violationsData !== null) {
        violations = Object.values(violationsData).flat().filter(Array.isArray);
      }
      
      let hasViolations = false;
      
      // Process all violations
      violations.forEach(violation => {
        if (!violation) return;
        
        // Get nodes (each node is an occurrence of this violation)
        const nodes = violation.nodes || [];
        if (nodes.length === 0) return;
        
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
        
        // Each node gets its own row in the CSV - this matches our UI counting
        nodes.forEach(node => {
          // Get node information
          let nodeInfo = 'N/A';
          if (node.target && Array.isArray(node.target) && node.target.length > 0) {
            nodeInfo = node.target[0].toString().replace(/"/g, '""').replace(/,/g, ';').substring(0, 100);
            if (nodeInfo.length >= 100) nodeInfo += '...';
          }
          
          // Write the detailed issue row
          csvStream.write(`"${pageUrl}",${status},"${violation.id || 'Unknown'}",Level ${wcagLevel},${category},"${description}",${impact},"${nodeInfo}"\n`);
        });
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
  generateCSV,
  getReportPaths,
  safeJsonParse
};
