const { analyzePageLoadPerformance } = require('./performance/pageLoadAnalyzer');
const { analyzeContentLoadingPatterns } = require('./performance/contentLoadingAnalyzer');
const { analyzeProgressiveRendering } = require('./performance/progressiveRenderingAnalyzer');
const { analyzeNetworkRequests } = require('./performance/networkRequestsAnalyzer');
const { analyzeAssetOptimization } = require('./performance/assetOptimizationAnalyzer');

module.exports = {
  analyzePageLoadPerformance,
  analyzeContentLoadingPatterns,
  analyzeProgressiveRendering,
  analyzeNetworkRequests,
  analyzeAssetOptimization
};
