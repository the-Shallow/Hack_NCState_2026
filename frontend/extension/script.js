(() => {
  const postCache = new Map();
  
  const AI_GENERATED_THRESHOLD = 7;
  const NEWS_THRESHOLD = 5;
  const SCROLL_DEBOUNCE_MS = 200;
  
  
  console.log('[AIBot Extension] Content script loaded on Instagram');

  function getAllPosts() {
    const posts = document.querySelectorAll('article');
    console.log(`[AIBot Extension] Found ${posts.length} article elements`);
    
    const mappedPosts = Array.from(posts).map((post, index) => {
      // Try multiple image selectors in order of preference
      let img = null;
      
      // Option 1: Instagram's post image container classes
      img = post.querySelector('div._aagu._aa20 div._aagv img');
      
      // Option 2: Image with "Photo by" alt text pattern
      if (!img) {
        img = post.querySelector('img[alt^="Photo by"]');
      }
      
      // Option 3: First image that doesn't have "profile picture" in alt
      if (!img) {
        const allImages = post.querySelectorAll('img');
        img = Array.from(allImages).find(img => 
          !img.alt.includes('profile picture') && 
          img.src &&
          img.width > 100 // Skip small avatars/icons
        );
      }
      
      const imageUrl = img ? img.src : null;
      
      // Try multiple caption selectors
      let caption = '';
      
      // Option 1: Caption span with specific classes (_aacu marks caption text)
      const captionEl = post.querySelector('span._ap3a._aacu');
      if (captionEl) {
        caption = captionEl.textContent.trim();
      }
      
      // Option 2: All caption spans and filter by content
      if (!caption) {
        const spans = post.querySelectorAll('span._ap3a');
        for (const span of spans) {
          const text = span.textContent.trim();
          // Skip if it's likely a username, location, or time
          if (text && 
              !span.closest('a[href*="/explore/locations/"]') && // Not location
              !span.closest('time') && // Not timestamp
              text.length > 5 && // Not just a username
              !text.match(/^\d+\s*(likes?|others?)$/i) // Not like count
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
    }).filter(post => post.imageUrl);

    
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
    
    const uncachedPosts = posts.filter(post => !postCache.has(post.imageUrl));
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
    
    let hiddenCount = 0;
    posts.forEach(post => {
      const cachedResult = postCache.get(post.imageUrl);
      if (cachedResult && cachedResult.shouldHide) {
        hidePost(post);
        hiddenCount++;
      }
    });
    
    console.log(`[AIBot Extension] Hidden ${hiddenCount} posts`);
  }
  
  function hidePost(post) {
    if (post.element) {
      post.element.style.display = 'none';
      console.log('[AIBot Extension] Hiding post:', post.imageUrl.substring(0, 50) + '...');
    }
  }
  
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      processPosts();
    }, SCROLL_DEBOUNCE_MS);
  });
  
  processPosts();
})();
