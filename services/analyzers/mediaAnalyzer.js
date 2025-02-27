const logger = require('../../utils/logger');

async function analyzeMediaContent(page, url) {
  logger.info(`Analyzing media accessibility for: ${url}`);
  
  try {
    const mediaIssues = await page.evaluate(() => {
      const issues = [];
      
      // Check videos for captions
      const videos = Array.from(document.querySelectorAll('video'));
      videos.forEach((video, index) => {
        const hasCaptions = Array.from(video.querySelectorAll('track')).some(
          track => track.kind === 'captions' || track.kind === 'subtitles'
        );
        
        if (!hasCaptions) {
          issues.push({
            id: 'video-no-captions',
            impact: 'critical',
            description: 'Video does not have captions. Videos must have captions for users who are deaf or hard of hearing.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#captions-prerecorded',
            nodes: [{ target: [`video-${index}`] }],
            element: video.outerHTML.substring(0, 200)
          });
        }
        
        const hasAudioDescription = Array.from(video.querySelectorAll('track')).some(
          track => track.kind === 'descriptions'
        );
        
        if (!hasAudioDescription) {
          issues.push({
            id: 'video-no-audio-description',
            impact: 'serious',
            description: 'Video may need audio descriptions for visual content that is not available in the audio track.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#audio-description-or-media-alternative-prerecorded',
            nodes: [{ target: [`video-${index}`] }],
            element: video.outerHTML.substring(0, 200)
          });
        }
      });
      
      // Check audio elements for transcripts
      const audios = Array.from(document.querySelectorAll('audio'));
      audios.forEach((audio, index) => {
        issues.push({
          id: 'audio-needs-transcript',
          impact: 'moderate',
          description: 'Audio element found. Ensure a text transcript is provided nearby.',
          helpUrl: 'https://www.w3.org/TR/WCAG21/#audio-only-and-video-only-prerecorded',
          nodes: [{ target: [`audio-${index}`] }],
          element: audio.outerHTML.substring(0, 200)
        });
      });
      
      // Check YouTube iframes
      const youtubeIframes = Array.from(document.querySelectorAll('iframe')).filter(
        iframe => iframe.src && iframe.src.includes('youtube.com/embed')
      );
      
      youtubeIframes.forEach((iframe, index) => {
        const forcesCC = iframe.src.includes('cc_load_policy=1');
        
        if (!forcesCC) {
          issues.push({
            id: 'youtube-captions-not-forced',
            impact: 'moderate',
            description: 'YouTube embed does not force captions on. Consider adding cc_load_policy=1 to the embed URL.',
            helpUrl: 'https://www.w3.org/TR/WCAG21/#captions-prerecorded',
            nodes: [{ target: [`youtube-${index}`] }],
            element: iframe.outerHTML.substring(0, 200)
          });
        }
      });
      
      return issues;
    });
    
    return {
      url,
      violations: mediaIssues,
      violationCounts: {
        total: mediaIssues.length,
        critical: mediaIssues.filter(i => i.impact === 'critical').length,
        warning: mediaIssues.filter(i => i.impact === 'serious' || i.impact === 'moderate').length,
        info: mediaIssues.filter(i => i.impact === 'minor').length
      }
    };
  } catch (error) {
    logger.error(`Error analyzing media on ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

module.exports = { analyzeMediaContent };
