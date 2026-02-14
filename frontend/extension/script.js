(() => {
  const postCache = new Map();
  const removedPostUrls = new Set();
  const processedPostUrls = new Set();
  let totalRemovedCount = 0;
  
  // Default threshold values
  let AI_GENERATED_THRESHOLD = 7;
  let NEWS_THRESHOLD = 5;
  const SCROLL_DEBOUNCE_MS = 200;
  
  console.log('[AIBot Extension] Content script loaded on Instagram');

  // Load thresholds from storage
  chrome.storage.sync.get(['aiGeneratedThreshold', 'newsThreshold', 'totalRemovedCount', 'removedPostUrls'], (data) => {
    if (data.aiGeneratedThreshold !== undefined) {
      AI_GENERATED_THRESHOLD = data.aiGeneratedThreshold;
    }
    if (data.newsThreshold !== undefined) {
      NEWS_THRESHOLD = data.newsThreshold;
    }
    if (data.totalRemovedCount !== undefined) {
      totalRemovedCount = data.totalRemovedCount;
    }
    if (data.removedPostUrls) {
      data.removedPostUrls.forEach(url => removedPostUrls.add(url));
    }
    console.log(`[AIBot Extension] Loaded thresholds - AI: ${AI_GENERATED_THRESHOLD}, News: ${NEWS_THRESHOLD}`);
  });

  // Listen for threshold changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.aiGeneratedThreshold) {
        AI_GENERATED_THRESHOLD = changes.aiGeneratedThreshold.newValue;
        console.log(`[AIBot Extension] AI threshold updated to ${AI_GENERATED_THRESHOLD}`);
        processPosts();
      }
      if (changes.newsThreshold) {
        NEWS_THRESHOLD = changes.newsThreshold.newValue;
        console.log(`[AIBot Extension] News threshold updated to ${NEWS_THRESHOLD}`);
        processPosts();
      }
    }
  });

  function getAllPosts() {
    const posts = document.querySelectorAll('article:not([data-aibot-processed])');
    console.log(`[AIBot Extension] Found ${posts.length} unprocessed article elements`);
    
    const mappedPosts = Array.from(posts).map((post, index) => {
      // Skip posts already converted to placeholders
      if (post.querySelector('.aibot-placeholder')) {
        return null;
      }
      
      let img = null;
      
      img = post.querySelector('div._aagu._aa20 div._aagv img');
      
      if (!img) {
        img = post.querySelector('img[alt^="Photo by"]');
      }
      
      if (!img) {
        const allImages = post.querySelectorAll('img');
        img = Array.from(allImages).find(img => 
          !img.alt.includes('profile picture') && 
          img.src &&
          img.width > 100
        );
      }
      
      const imageUrl = img ? img.src : null;
      
      let caption = '';
      
      const captionEl = post.querySelector('span._ap3a._aacu');
      if (captionEl) {
        caption = captionEl.textContent.trim();
      }
      
      if (!caption) {
        const spans = post.querySelectorAll('span._ap3a');
        for (const span of spans) {
          const text = span.textContent.trim();
          if (text && 
              !span.closest('a[href*="/explore/locations/"]') &&
              !span.closest('time') &&
              text.length > 5 &&
              !text.match(/^\d+\s*(likes?|others?)$/i)
          ) {
            caption = text;
            break;
          }
        }
      }
      
      return { 
        element: post,
        imageUrl, 
        caption: caption.substring(0, 100) + (caption.length > 100 ? '...' : '')
      };
    }).filter(post => post && post.imageUrl);

    console.log('[AIBot Extension] Mapped posts:', mappedPosts);
    return mappedPosts;
  }
  
  function shouldHidePost(aiGeneratedScore, newsScore) {
    return aiGeneratedScore > AI_GENERATED_THRESHOLD || newsScore > NEWS_THRESHOLD;
  }
  
  async function mockBackendRequest(imageUrls) {
    console.log(`[AIBot Extension] Sending ${imageUrls.length} images to backend`);
    await new Promise(resolve => setTimeout(resolve, 100));
    return imageUrls.map(imageUrl => ({
      imageUrl,
      aiGeneratedScore: Math.floor(Math.random() * 10),
      newsScore: Math.floor(Math.random() * 10)
    }));
  }
  
  async function processPosts() {
    console.log('[AIBot Extension] Processing posts...');
    const posts = getAllPosts();
    
    // Filter out posts already processed (converted to placeholder)
    const newPosts = posts.filter(post => !removedPostUrls.has(post.imageUrl));
    
    const uncachedPosts = newPosts.filter(post => !postCache.has(post.imageUrl));
    console.log(`[AIBot Extension] ${uncachedPosts.length} uncached posts`);
    
    if (uncachedPosts.length > 0) {
      const imageUrls = uncachedPosts.map(post => post.imageUrl);
      const results = await mockBackendRequest(imageUrls);

      results.forEach(result => {
        postCache.set(result.imageUrl, {
          aiGeneratedScore: result.aiGeneratedScore,
          newsScore: result.newsScore,
          shouldHide: shouldHidePost(result.aiGeneratedScore, result.newsScore)
        });
      });
      
      console.log('[AIBot Extension] Backend results:', results);
    }
    
    let newlyRemoved = 0;
    newPosts.forEach(post => {
      const cachedResult = postCache.get(post.imageUrl);
      if (cachedResult && cachedResult.shouldHide) {
        removePost(post);
        newlyRemoved++;
      }
    });
    
    // Update and persist total count
    if (newlyRemoved > 0) {
      totalRemovedCount += newlyRemoved;
      chrome.storage.sync.set({ hiddenCount: totalRemovedCount });
      console.log(`[AIBot Extension] Removed ${newlyRemoved} new posts. Total removed: ${totalRemovedCount}`);
    }
  }
  
  function getPlaceholderHTML() {
    return `
      <div class="aibot-placeholder" style="
        background: linear-gradient(135deg, rgba(20, 20, 20, 0.95) 0%, rgba(40, 40, 40, 0.95) 100%);
        min-height: 400px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
        border-radius: 8px;
        margin: 8px 0;
        border: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="
          font-size: 48px;
          margin-bottom: 16px;
          filter: grayscale(100%) brightness(200%);
        ">🤖</div>
        <h3 style="
          color: #e0e0e0;
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">AI Generated Content</h3>
        <p style="
          color: #888;
          font-size: 14px;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">Removed by AIBot</p>
        <div style="
          margin-top: 16px;
          padding: 6px 12px;
          background: rgba(77, 171, 247, 0.2);
          border-radius: 12px;
          font-size: 11px;
          color: #4dabf7;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">Filtered</div>
      </div>
    `;
  }

  function removePost(post) {
    if (post.element && post.imageUrl) {
      removedPostUrls.add(post.imageUrl);
      
      // Replace post content with placeholder while keeping the article element
      post.element.innerHTML = getPlaceholderHTML();
      post.element.style.pointerEvents = 'none';
      post.element.setAttribute('data-aibot-processed', 'true');
      post.element.setAttribute('data-aibot-removed', 'true');
      
      // Persist to storage
      chrome.storage.sync.set({ 
        removedPostUrls: Array.from(removedPostUrls)
      });
      
      console.log('[AIBot Extension] Replaced post with placeholder:', post.imageUrl.substring(0, 50) + '...');
    }
  }
  
  function processSinglePost(postElement) {
    // Skip if already processed
    if (postElement.hasAttribute('data-aibot-processed') || 
        postElement.querySelector('.aibot-placeholder')) {
      return;
    }
    
    let img = null;
    
    img = postElement.querySelector('div._aagu._aa20 div._aagv img');
    
    if (!img) {
      img = postElement.querySelector('img[alt^="Photo by"]');
    }
    
    if (!img) {
      const allImages = postElement.querySelectorAll('img');
      img = Array.from(allImages).find(img => 
        !img.alt.includes('profile picture') && 
        img.src &&
        img.width > 100
      );
    }
    
    const imageUrl = img ? img.src : null;
    
    if (!imageUrl) {
      return;
    }
    
    // Check if this URL should be hidden immediately
    if (removedPostUrls.has(imageUrl)) {
      postElement.innerHTML = getPlaceholderHTML();
      postElement.style.pointerEvents = 'none';
      postElement.setAttribute('data-aibot-processed', 'true');
      postElement.setAttribute('data-aibot-removed', 'true');
      console.log('[AIBot Extension] Immediately re-hidden known post:', imageUrl.substring(0, 50) + '...');
      return;
    }
    
    // Check cache
    const cachedResult = postCache.get(imageUrl);
    if (cachedResult) {
      if (cachedResult.shouldHide) {
        removedPostUrls.add(imageUrl);
        postElement.innerHTML = getPlaceholderHTML();
        postElement.style.pointerEvents = 'none';
        postElement.setAttribute('data-aibot-processed', 'true');
        postElement.setAttribute('data-aibot-removed', 'true');
        chrome.storage.sync.set({ 
          removedPostUrls: Array.from(removedPostUrls)
        });
        console.log('[AIBot Extension] Replaced cached post with placeholder:', imageUrl.substring(0, 50) + '...');
      } else {
        postElement.setAttribute('data-aibot-processed', 'true');
        postElement.setAttribute('data-aibot-safe', 'true');
      }
    }
  }
  
  // Set up MutationObserver to watch for new posts
  const observer = new MutationObserver((mutations) => {
    let newPostsFound = false;
    
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the added node is an article
          if (node.tagName === 'ARTICLE') {
            processSinglePost(node);
            newPostsFound = true;
          }
          // Check if the added node contains articles
          if (node.querySelectorAll) {
            const articles = node.querySelectorAll('article');
            articles.forEach(article => {
              processSinglePost(article);
              newPostsFound = true;
            });
          }
        }
      });
    });
    
    if (newPostsFound) {
      // Update hidden count after processing new posts
      const currentHidden = document.querySelectorAll('article[data-aibot-removed]').length;
      if (currentHidden !== totalRemovedCount) {
        totalRemovedCount = currentHidden;
        chrome.storage.sync.set({ hiddenCount: totalRemovedCount });
      }
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      processPosts();
    }, SCROLL_DEBOUNCE_MS);
  });
  
  processPosts();
})();
