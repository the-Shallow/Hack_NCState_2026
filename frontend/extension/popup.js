document.addEventListener('DOMContentLoaded', () => {
  const aiThresholdInput = document.getElementById('aiThreshold');
  const aiThresholdValue = document.getElementById('aiThresholdValue');
  const newsThresholdInput = document.getElementById('newsThreshold');
  const newsThresholdValue = document.getElementById('newsThresholdValue');
  const hiddenCountElement = document.getElementById('hiddenCount');

  // Load saved thresholds and hidden count
  chrome.storage.sync.get(['aiGeneratedThreshold', 'newsThreshold', 'hiddenCount'], (data) => {
    if (data.aiGeneratedThreshold !== undefined) {
      aiThresholdInput.value = data.aiGeneratedThreshold;
      aiThresholdValue.textContent = data.aiGeneratedThreshold;
    }
    if (data.newsThreshold !== undefined) {
      newsThresholdInput.value = data.newsThreshold;
      newsThresholdValue.textContent = data.newsThreshold;
    }
    if (data.hiddenCount !== undefined) {
      hiddenCountElement.textContent = data.hiddenCount;
    }
  });

  // Listen for storage changes to update hidden count in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.hiddenCount) {
      hiddenCountElement.textContent = changes.hiddenCount.newValue;
    }
  });

  // Listen for threshold changes
  aiThresholdInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    aiThresholdValue.textContent = value;
    chrome.storage.sync.set({ aiGeneratedThreshold: value });
  });

  newsThresholdInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    newsThresholdValue.textContent = value;
    chrome.storage.sync.set({ newsThreshold: value });
  });
});
