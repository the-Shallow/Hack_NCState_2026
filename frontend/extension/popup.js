document.addEventListener('DOMContentLoaded', () => {
  const errorMessage = document.getElementById('errorMessage');
  const contentSection = document.getElementById('contentSection');
  const aiThresholdInput = document.getElementById('aiThreshold');
  const aiThresholdValue = document.getElementById('aiThresholdValue');
  const newsThresholdInput = document.getElementById('newsThreshold');
  const newsThresholdValue = document.getElementById('newsThresholdValue');
  const hiddenCountElement = document.getElementById('hiddenCount');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    const url = currentTab.url || currentTab.pendingUrl || '';

    if (!url.includes('instagram.com')) {
      errorMessage.classList.add('visible');
      return;
    }

    contentSection.classList.add('visible');

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

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.hiddenCount) {
        hiddenCountElement.textContent = changes.hiddenCount.newValue;
      }
    });

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
});
