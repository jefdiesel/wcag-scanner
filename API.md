# WCAG Accessibility Scanner API

The WCAG Accessibility Scanner API provides programmatic access to scan websites for accessibility issues, retrieve results, and generate reports. This document outlines the API endpoints, authentication, request/response formats, and usage examples.

## Authentication

All API requests require an API key sent in the `X-API-Key` header:

```
X-API-Key: your-api-key-here
```

Contact your administrator to obtain an API key. Each API key has an associated rate limit (default: 100 requests per day).

## Endpoints

### Check API Status

```
GET /api/status
```

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "user": "username"
}
```

### Start a New Scan

```
POST /api/scan
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | String | Yes | URL to scan |
| maxPages | Number | No | Maximum number of pages to scan (default: 100, max: 10000) |
| maxDepth | Number | No | Maximum crawl depth (default: 5, max: 10) |
| queue | Boolean | No | Whether to queue the scan instead of running it immediately (default: false) |

**Example Request:**
```json
{
  "url": "https://example.com",
  "maxPages": 50,
  "maxDepth": 3,
  "queue": false
}
```

**Example Response:**
```json
{
  "scanId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "message": "Scan has been started"
}
```

### Check Scan Status

```
GET /api/scan/:scanId
```

**Example Response (in progress):**
```json
{
  "scanId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://example.com",
  "status": "running",
  "requestedAt": "2023-10-15T14:30:00Z",
  "pagesScanned": 25,
  "pagesFound": 85,
  "issues": {
    "total": 120,
    "critical": 45,
    "warning": 65,
    "info": 10
  }
}
```

**Example Response (completed):**
```json
{
  "scanId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://example.com",
  "status": "completed",
  "requestedAt": "2023-10-15T14:30:00Z",
  "pagesScanned": 50,
  "pagesFound": 85,
  "issues": {
    "total": 237,
    "critical": 84,
    "warning": 103,
    "info": 50
  },
  "reports": {
    "pdf": "https://example.com/reports/example.com/example.com.pdf",
    "csv": "https://example.com/reports/example.com/example.com.csv"
  }
}
```

### Get Detailed Scan Results

```
GET /api/scan/:scanId/details
```

**Example Response:**
```json
{
  "scanId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://example.com",
  "requestedAt": "2023-10-15T14:30:00Z",
  "status": "completed",
  "results": [
    {
      "url": "https://example.com",
      "status": 200,
      "scannedAt": "2023-10-15T14:35:00Z",
      "violationCounts": {
        "total": 45,
        "critical": 12,
        "warning": 28,
        "info": 5
      },
      "violations": [
        {
          "id": "color-contrast",
          "impact": "serious",
          "description": "Elements must have sufficient color contrast",
          "nodes": [
            {
              "target": ["#header h1"],
              "html": "<h1 style=\"color: #777\">Example Website</h1>"
            }
          ]
        }
      ],
      "additionalAnalysis": {
        "hasMediaIssues": true,
        "hasKeyboardIssues": false,
        "needsManualReview": true,
        "hasAccessibilityStatement": false
      }
    }
  ]
}
```

### List All Scans

```
GET /api/scans
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | Number | No | Maximum number of scans to return (default: 20, max: 100) |
| offset | Number | No | Offset for pagination (default: 0) |

**Example Response:**
```json
{
  "scans": [
    {
      "scan_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "url": "https://example.com",
      "max_pages": 50,
      "max_depth": 3,
      "requested_at": "2023-10-15T14:30:00Z",
      "status": "completed"
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "more": true
  }
}
```

## Rate Limiting

The API enforces rate limits to prevent abuse. Each API key has a daily limit (default: 100 requests per day). Rate limit information is provided in the response headers:

- `X-RateLimit-Limit`: Your total allowed requests per day
- `X-RateLimit-Reset`: The timestamp when your rate limit resets (Unix timestamp)

If you exceed your rate limit, you'll receive a 429 Too Many Requests response.

## Error Handling

The API uses standard HTTP status codes:

| Status Code | Description |
|-------------|-------------|
| 200 OK | The request was successful |
| 201 Created | Resource created successfully |
| 202 Accepted | The request has been accepted for processing |
| 400 Bad Request | The request was invalid or contains invalid parameters |
| 401 Unauthorized | Authentication is required or failed |
| 404 Not Found | The requested resource was not found |
| 429 Too Many Requests | Rate limit exceeded |
| 500 Internal Server Error | An unexpected error occurred on the server |

Error responses include a JSON object with an error message:

```json
{
  "error": "Invalid URL format"
}
```

## Code Examples

### cURL

```bash
curl -X POST "https://example.com/api/scan" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "maxPages": 50}'
```

### Node.js

```javascript
const axios = require('axios');

async function startScan() {
  try {
    const response = await axios.post('https://example.com/api/scan', {
      url: 'https://example.com',
      maxPages: 50
    }, {
      headers: {
        'X-API-Key': 'your-api-key-here',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(response.data);
  } catch (error) {
    console.error(error.response.data);
  }
}

startScan();
```

### Python

```python
import requests

def start_scan():
    url = 'https://example.com/api/scan'
    headers = {
        'X-API-Key': 'your-api-key-here',
        'Content-Type': 'application/json'
    }
    data = {
        'url': 'https://example.com',
        'maxPages': 50
    }
    
    response = requests.post(url, json=data, headers=headers)
    return response.json()

result = start_scan()
print(result)
```

## Integration Use Cases

### Continuous Integration

Integrate accessibility scanning into your CI/CD pipeline to catch accessibility issues before deploying to production.

```bash
# Example CI script
API_KEY="your-api-key-here"
SITE_URL="https://staging.example.com"

# Start scan
SCAN_RESPONSE=$(curl -s -X POST "https://scanner.example.com/api/scan" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$SITE_URL\", \"maxPages\": 50}")

# Extract scan ID
SCAN_ID=$(echo $SCAN_RESPONSE | grep -o '"scanId":"[^"]*' | cut -d'"' -f4)

# Poll for completion
while true; do
  STATUS_RESPONSE=$(curl -s -X GET "https://scanner.example.com/api/scan/$SCAN_ID" \
    -H "X-API-Key: $API_KEY")
  
  STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*' | cut -d'"' -f4)
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  
  sleep 10
done

# Check for critical issues
CRITICAL_ISSUES=$(echo $STATUS_RESPONSE | grep -o '"critical":[0-9]*' | cut -d':' -f2)

if [ "$CRITICAL_ISSUES" -gt 0 ]; then
  echo "❌ Found $CRITICAL_ISSUES critical accessibility issues"
  exit 1
else
  echo "✅ No critical accessibility issues found"
  exit 0
fi
```

### Scheduled Monitoring

Set up regular scans to monitor accessibility compliance over time.

```javascript
// Example Node.js scheduler using cron
const cron = require('node-cron');
const axios = require('axios');

// Schedule weekly scans
cron.schedule('0 0 * * 0', async () => {
  console.log('Running weekly accessibility scan');
  
  try {
    // Start scan
    const response = await axios.post('https://scanner.example.com/api/scan', {
      url: 'https://example.com',
      maxPages: 100
    }, {
      headers: {
        'X-API-Key': 'your-api-key-here',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Scan started with ID: ${response.data.scanId}`);
  } catch (error) {
    console.error('Failed to start scan:', error.response?.data || error.message);
  }
});
```

## Getting an API Key

Contact your administrator to obtain an API key. If you have admin access, you can create API keys through the admin interface:

1. Navigate to the admin dashboard
2. Go to "API Users" section
3. Click "Create New API User"
4. Fill in the required information and submit
5. Save the generated API key (it will only be shown once)
