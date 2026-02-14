let getAllPosts = function() {
    const posts = document.querySelectorAll("x78zum5 xdt5ytf x5yr21d xa1mljc xh8yej3 x1bs97v6 x1q0q8m5 x11aubdm xnc8uc2 x1qhh985");
    return posts.map(post => {
        const imageUrl = post.querySelector("x1n2onr6").src;
        const caption = post.querySelector("_ap3a _aaco _aacu _aacx _aad7 _aade");
        return { imageUrl, caption }
    });
}

const postCache = new Map();

const AI_GENERATED_THRESHOLD = 7;
const NEWS_THRESHOLD = 5;
const SCROLL_DEBOUNCE_MS = 200;

function shouldHidePost(aiGeneratedScore, newsScore) {
  return aiGeneratedScore > AI_GENERATED_THRESHOLD || newsScore > NEWS_THRESHOLD;
}

async function mockBackendRequest(imageUrls) {
  await new Promise(resolve => setTimeout(resolve, 100));
  return imageUrls.map(imageUrl => ({
    imageUrl,
    aiGeneratedScore: Math.floor(Math.random() * 10),
    newsScore: Math.floor(Math.random() * 10)
  }));
}

async function processPosts() {
  const posts = getAllPosts();
  const uncachedPosts = posts.filter(post => !postCache.has(post.imageUrl));
  
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
  }
  
  posts.forEach(post => {
    const cachedResult = postCache.get(post.imageUrl);
    if (cachedResult && cachedResult.shouldHide) {
      hidePost(post);
    }
  });
}

function hidePost(post) {
  if (post.element) {
    post.element.style.display = 'none';
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



