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
      const img = post.querySelector('img[srcset]');
      const imageUrl = img ? img.src : null;
      
      const captionElement = post.querySelector('span[class*="_ap3a"]') || 
                           post.querySelector('h1[class*="_ap3a"]');
      const caption = captionElement ? captionElement.innerText : '';
      
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
