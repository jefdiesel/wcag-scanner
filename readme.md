# WCAG Accessibility Scanner

A powerful, modular web application for scanning websites against WCAG accessibility standards, generating comprehensive reports, and managing scan queues.

## Project Structure

The project has been organized into a modular structure to improve maintainability and efficiency:

```
project-root/
├── server.js                   # Main entry point
├── config/                     # Configuration settings
├── db/                         # Database connection and operations
├── routes/                     # Route handlers
├── services/                   # Core business logic
├── utils/                      # Utility functions
├── middleware/                 # Express middleware
├── public/                     # Static assets
└── views/                      # EJS templates
```

## Features

- **WCAG Testing**: Tests against WCAG 2.1 Level A, AA, and AAA criteria
- **Crawling**: Automatically discovers and tests linked pages
- **Queue System**: Schedule scans to run in the background
- **Reporting**: Generates detailed PDF and CSV reports
- **Modern UI**: Clean, responsive interface for managing scans

## Setup and Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/wcag-accessibility-scanner.git
cd wcag-accessibility-scanner
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure the application**

Review and adjust settings in the `config/config.js` file if needed.

4. **Start the server**

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

5. **Access the application**

Open your browser and navigate to: `http://localhost:3000`

## Usage

### Starting a New Scan

1. Enter the URL of the website you want to scan
2. Set the maximum number of pages to scan
3. Choose whether to scan immediately or add to queue
4. Click "Start Scan" 

### Managing the Queue

1. Go to the "Scan Queue" tab
2. View queued URLs and their scan settings
3. Add new URLs to the queue
4. Remove URLs from the queue

### Viewing Reports

1. Go to the "Reports" tab to see all completed scans
2. Download generated PDF and CSV reports
3. View scan results directly in the browser

## Development

### Adding New Features

The modular structure makes it easy to extend functionality:

- Add new routes in the `routes/` directory
- Implement new services in the `services/` directory
- Create utility functions in the `utils/` directory

### Running Tests

```bash
npm test
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
