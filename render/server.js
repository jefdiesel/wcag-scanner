// Function to send results email
async function sendResultsEmail(email, url, scanId, reportUrl, summary) {
  try {
    const mailOptions = {
      from: `"A11yscan" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Your A11yscan Accessibility Report is Ready',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://a11yscan.xyz/images/a11yscan-logo.svg" alt="A11yscan Logo" width="180" height="50" style="display: inline-block;">
          </div>
          
          <h1 style="color: #4f46e5; margin-bottom: 20px;">Your Accessibility Report is Ready</h1>
          
          <p>Hello,</p>
          
          <p>Good news! We've completed the accessibility scan for your website.</p>
          
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Website URL:</strong> ${url}</p>
            <p style="margin: 10px 0 0;"><strong>Scan ID:</strong> ${scanId}</p>
          </div>
          
          <h2 style="color: #4f46e5; margin: 25px 0 15px;">Summary of Findings</h2>
          
          <div style="margin-bottom: 20px;">
            <p><strong>Pages Scanned:</strong> ${summary.pagesScanned}</p>
            <p><strong>Total Issues Found:</strong> ${summary.totalIssues}</p>
            <ul>
              <li><strong style="color: #ef4444;">Critical Issues:</strong> ${summary.criticalIssues}</li>
              <li><strong style="color: #f59e0b;">Warning Issues:</strong> ${summary.warningIssues}</li>
              <li><strong style="color: #3b82f6;">Info Issues:</strong> ${summary.infoIssues}</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${reportUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View Full Report</a>
          </div>
          
          <p>This report highlights accessibility issues on your website that may prevent people with disabilities from using it effectively. Addressing these issues will help you:</p>
          
          <ul>
            <li>Provide a better experience for all users</li>
            <li>Reach a wider audience</li>
            <li>Reduce legal risk</li>
            <li>Improve your SEO</li>
          </ul>
          
          <p>Your free report will be available for 7 days. For more comprehensive testing and ongoing monitoring, check out our <a href="https://a11yscan.xyz/#pricing" style="color: #4f46e5;">paid plans</a>.</p>
          
          <p>Thank you for making the web more accessible for everyone!</p>
          
          <p>Best regards,<br>The A11yscan Team</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
            <p>© 2023 A11yscan. All rights reserved.</p>
            <p>If you have any questions, please contact us at <a href="mailto:hello@a11yscan.xyz" style="color: #4f46e5;">hello@a11yscan.xyz</a></p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Results email sent to ${email} for scan ${scanId}`);
    return true;
  } catch (error) {
    console.error(`Error sending results email for ${scanId}:`, error);
    throw error;
  }
}

// Function to initiate a free scan (limited to 5 pages)
async function initiateFreeScan(scanId, url, email) {
  try {
    // Update scan status to running
    await updateScanStatus(scanId, 'running');
    
    // Call your WCAG scanner API
    // For this example, we're assuming your scanner API is accessible via HTTP
    // In a real implementation, you might use a direct function call or message queue
    const apiUrl = process.env.SCANNER_API_URL;
    const apiKey = process.env.SCANNER_API_KEY;
    
    const scanOptions = {
      url: url,
      maxPages: 5, // Limit free scans to 5 pages
      maxDepth: 3,
      scanId: scanId,
      returnUrl: `https://a11yscan.xyz/reports/${scanId}`
    };
    
    // Send request to your scanner API
    const response = await axios.post(`${apiUrl}/api/scan`, scanOptions, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status !== 202) {
      throw new Error(`Unexpected API response: ${response.status}`);
    }
    
    console.log(`Scan initiated for ${url} with ID ${scanId}`);
    
    // Now we need to monitor the scan status until it completes
    // This is a simplified example - in production you'd use a job queue
    await monitorScanStatus(scanId, url, email);
    
  } catch (error) {
    console.error(`Error initiating scan for ${scanId}:`, error);
    await updateScanStatus(scanId, 'failed');
    
    // Send error notification email
    try {
      await sendErrorEmail(email, url, scanId, error.message);
    } catch (emailError) {
      console.error(`Failed to send error email for ${scanId}:`, emailError);
    }
  }
}

// Function to monitor scan status
async function monitorScanStatus(scanId, url, email) {
  // In a real implementation, this would be handled by a job queue/worker
  // For simplicity, we're using a polling approach here
  
  const maxAttempts = 60; // 30 minutes (checking every 30 seconds)
  let attempts = 0;
  
  const checkStatus = async () => {
    try {
      attempts++;
      
      // Get scan status from your scanner API
      const apiUrl = process.env.SCANNER_API_URL;
      const apiKey = process.env.SCANNER_API_KEY;
      
      const response = await axios.get(`${apiUrl}/api/scan/${scanId}`, {
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      const status = response.data.status;
      
      if (status === 'completed') {
        // Scan completed successfully
        await updateScanStatus(scanId, 'completed', new Date().toISOString());
        
        // Get report URL
        const reportUrl = `https://a11yscan.xyz/reports/${scanId}`;
        
        // Create summary from scan results
        const summary = {
          pagesScanned: response.data.pagesScanned || 0,
          totalIssues: response.data.issues?.total || 0,
          criticalIssues: response.data.issues?.critical || 0,
          warningIssues: response.data.issues?.warning || 0,
          infoIssues: response.data.issues?.info || 0
        };
        
        // Send results email
        await sendResultsEmail(email, url, scanId, reportUrl, summary);
        
        return;
      } else if (status === 'failed') {
        // Scan failed
        await updateScanStatus(scanId, 'failed');
        
        // Send error email
        await sendErrorEmail(email, url, scanId, 'The scan failed to complete. Please try again later.');
        
        return;
      } else if (attempts >= maxAttempts) {
        // Timeout reached
        await updateScanStatus(scanId, 'timeout');
        
        // Send timeout email
        await sendErrorEmail(email, url, scanId, 'The scan timed out. This might be due to a very large website or connectivity issues.');
        
        return;
      }
      
      // If still running, check again after delay
      setTimeout(checkStatus, 30000); // Check every 30 seconds
      
    } catch (error) {
      console.error(`Error checking status for scan ${scanId}:`, error);
      
      if (attempts >= maxAttempts) {
        await updateScanStatus(scanId, 'error');
        await sendErrorEmail(email, url, scanId, 'An error occurred while monitoring the scan.');
      } else {
        // Retry after delay
        setTimeout(checkStatus, 30000);
      }
    }
  };
  
  // Start monitoring
  setTimeout(checkStatus, 10000); // First check after 10 seconds
}

// Function to send error email
async function sendErrorEmail(email, url, scanId, errorMessage) {
  try {
    const mailOptions = {
      from: `"A11yscan" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Issue with Your A11yscan Accessibility Scan',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://a11yscan.xyz/images/a11yscan-logo.svg" alt="A11yscan Logo" width="180" height="50" style="display: inline-block;">
          </div>
          
          <h1 style="color: #4f46e5; margin-bottom: 20px;">Issue with Your Accessibility Scan</h1>
          
          <p>Hello,</p>
          
          <p>We encountered an issue while scanning your website for accessibility issues.</p>
          
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Website URL:</strong> ${url}</p>
            <p style="margin: 10px 0 0;"><strong>Scan ID:</strong> ${scanId}</p>
          </div>
          
          <div style="background-color: #fee2e2; padding: 15px; border-radius: 5px; margin: 20px 0; color: #b91c1c;">
            <p style="margin: 0;"><strong>Error:</strong> ${errorMessage}</p>
          </div>
          
          <p>This could be due to several reasons:</p>
          
          <ul>
            <li>The website is not accessible or requires authentication</li>
            <li>The website has a robots.txt file blocking our scanner</li>
            <li>The website has security measures preventing automated scanning</li>
            <li>There might be temporary connectivity issues</li>
          </ul>
          
          <p>Please try again later or contact us if you continue experiencing issues.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://a11yscan.xyz/#scan" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Try Again</a>
          </div>
          
          <p>Thank you for your understanding.</p>
          
          <p>Best regards,<br>The A11yscan Team</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
            <p>© 2023 A11yscan. All rights reserved.</p>
            <p>If you have any questions, please contact us at <a href="mailto:hello@a11yscan.xyz" style="color: #4f46e5;">hello@a11yscan.xyz</a></p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Error email sent to ${email} for scan ${scanId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send error email for ${scanId}:`, error);
    throw error;
  }
}

// Serve scan status page
app.get('/scan-status/:scanId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan-status.html'));
});

// Serve report page
app.get('/reports/:scanId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`A11yscan website running on port ${port}`);
});
