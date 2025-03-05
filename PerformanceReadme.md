# WCAG Performance Accessibility Scanner

A specialized fork of the WCAG Accessibility Scanner that focuses on performance and loading issues that can make pages unusable for disabled users. This scanner recognizes that slow loading, layout shifts, and other performance issues create significant barriers for users with cognitive, motor, and visual disabilities.

## Overview

The WCAG Performance Accessibility Scanner evaluates web pages through the lens of performance-related accessibility concerns. While traditional accessibility testing focuses on markup, semantics, and compatibility with assistive technologies, this scanner addresses the often-overlooked performance aspects that disproportionately affect disabled users, including:

- Long load times that confuse users with cognitive disabilities
- Layout shifts that disorient screen magnifier users and those with motor impairments
- Interaction delays that frustrate users with switch controls or alternative input devices
- Missing loading indicators that leave screen reader users without context
- Resource-heavy pages that are inaccessible to users with older devices or limited bandwidth

## Key Features

- **Disability-Focused Performance Testing**: Each performance metric is analyzed for its specific impact on different disability groups
- **Device Emulation**: Tests across mobile, tablet, and desktop views to identify device-specific issues
- **Network Throttling**: Simulates slower connections to identify issues faced by users with bandwidth limitations
- **Cognitive Load Analysis**: Identifies visual stability issues, excessive animations, and content loading patterns that may overwhelm users
- **WCAG Correlation**: Maps performance issues to specific WCAG success criteria
- **Prioritized Recommendations**: Provides actionable suggestions based on accessibility impact, not just general performance

## Accessibility-Specific Performance Metrics

This scanner goes beyond standard web performance metrics by focusing on those with the greatest accessibility impact:

- **First Contentful Paint (FCP)**: Critical for screen reader users to begin interacting with content
- **Time to Interactive (TTI)**: Essential for users with motor disabilities who need reliable interaction
- **Cumulative Layout Shift (CLS)**: Vital for users with cognitive disabilities and those using screen magnifiers
- **Interaction Delays**: Critical for users with motor impairments who may lose track of interactions
- **Loading Indicator Analysis**: Important for screen reader users who need to know when content is loading
- **Content Sequencing**: Checks if critical content loads in a logical order for cognitive accessibility

## What Makes This Fork Special

Unlike generic performance testing tools, this scanner:

1. **Maps issues to affected disability groups**: Each issue clearly indicates which users are most affected (e.g., "Affects screen reader users, mobile users, users with cognitive disabilities")

2. **Considers assistive technology interactions**: Analyzes how performance issues specifically impact assistive technology users

3. **Provides accessibility-focused recommendations**: Recommendations prioritize accessibility improvements rather than just general performance optimizations

4. **Tests progressive enhancement**: Evaluates how well the site functions during the loading process, not just after it's fully loaded

5. **Customized severity ratings**: Issues are rated based on their impact on disabled users, not just on technical performance thresholds

## Setup and Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/wcag-performance-scanner.git
cd wcag-performance-scanner
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

### Starting a New Performance Scan

1. Enter the URL of the website you want to scan
2. Set the maximum number of pages to scan
3. Select device and network emulation options
4. Choose whether to scan immediately or add to queue
5. Click "Start Scan"

### Reviewing Performance Accessibility Reports

Performance accessibility reports include:

- Overall performance accessibility score
- Breakdown by device type (Mobile, Tablet, Desktop)
- Issues categorized by accessibility impact (Critical, High, Medium, Low)
- Detailed metrics for each performance category
- Specific recommendations with WCAG correlations
- Affected user groups for each issue

## Understanding the Results

### Accessibility Impact Levels

- **Critical**: Makes the page unusable for certain disability groups
- **High**: Creates significant barriers for disabled users
- **Medium**: Causes frustration or confusion for disabled users
- **Low**: Minor issues that may affect some users

### Performance Categories

- **Page Load Performance**: Overall loading speed and timing metrics
- **Content Loading Patterns**: How content appears during the loading process
- **Progressive Rendering**: Visual stability and content appearance sequence
- **Network Requests**: Resource loading efficiency and optimization
- **Asset Optimization**: Image, video, and animation optimization

## License

This project is licensed under the MIT License - see the LICENSE file for details.
