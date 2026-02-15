(() => {
  const postCache = new Map();
  const removedPostUrls = new Set();
  const originalPostContent = new Map();
  const inFlightUrls = new Set(); // Track URLs with active API requests
  let totalRemovedCount = 0;

  // Default threshold values (0.0-1.0 scale)
  let AI_GENERATED_THRESHOLD = 0.3;
  let NEWS_THRESHOLD = 0.2;
  const SCROLL_DEBOUNCE_MS = 200;

  // DEBUG: console.log("[AIBot Extension] Content script loaded on Instagram");

  // Load thresholds from storage
  chrome.storage.sync.get(
    [
      "aiGeneratedThreshold",
      "newsThreshold",
      "totalRemovedCount",
      "removedPostUrls",
    ],
    (data) => {
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
        data.removedPostUrls.forEach((url) => removedPostUrls.add(url));
      }
      // DEBUG: console.log(
      //   `[AIBot Extension] Loaded thresholds - AI: ${AI_GENERATED_THRESHOLD}, News: ${NEWS_THRESHOLD}`,
      // );
    },
  );

  // Listen for threshold changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync") {
      if (changes.aiGeneratedThreshold) {
        AI_GENERATED_THRESHOLD = changes.aiGeneratedThreshold.newValue;
        // DEBUG: console.log(
        //   `[AIBot Extension] AI threshold updated to ${AI_GENERATED_THRESHOLD}`,
        // );
        processPosts();
      }
      if (changes.newsThreshold) {
        NEWS_THRESHOLD = changes.newsThreshold.newValue;
        // DEBUG: console.log(
        //   `[AIBot Extension] News threshold updated to ${NEWS_THRESHOLD}`,
        // );
        processPosts();
      }
    }
  });

  function getAllPosts() {
    const posts = document.querySelectorAll(
      "article:not([data-aibot-processed])",
    );
    // DEBUG: console.log(
    //   `[AIBot Extension] Found ${posts.length} unprocessed article elements`,
    // );

    const mappedPosts = Array.from(posts).map((post, index) => {
      // Skip posts already converted to placeholders
      if (post.querySelector(".aibot-placeholder")) {
        return null;
      }

      let img = null;

      img = post.querySelector("div._aagu._aa20 div._aagv img");

      if (!img) {
        img = post.querySelector('img[alt^="Photo by"]');
      }

      if (!img) {
        const allImages = post.querySelectorAll("img");
        img = Array.from(allImages).find(
          (img) =>
            !img.alt.includes("profile picture") && img.src && img.width > 100,
        );
      }

      const imageUrl = img ? img.src : null;
      const imageAlt = img ? img.alt : null;

      let caption = "";

      const captionEl = post.querySelector("span._ap3a._aacu");
      if (captionEl) {
        caption = captionEl.textContent.trim();
      }

      if (!caption) {
        const spans = post.querySelectorAll("span._ap3a");
        for (const span of spans) {
          const text = span.textContent.trim();
          if (
            text &&
            !span.closest('a[href*="/explore/locations/"]') &&
            !span.closest("time") &&
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
        imageAlt,
        caption:
          caption.substring(0, 100) + (caption.length > 100 ? "..." : ""),
      };
    });

    // DEBUG: console.log("[AIBot Extension] Mapped posts:", mappedPosts);
    return mappedPosts;
  }

  function shouldHidePost(aiGeneratedScore, newsScore) {
    // DEBUG: console.log(`[AIBot Extension] Evaluating post - AI Score: ${aiGeneratedScore}, News Score: ${newsScore}`);
    // DEBUG: console.log(
    //   aiGeneratedScore > AI_GENERATED_THRESHOLD || newsScore > NEWS_THRESHOLD,
    // );
    const shouldHideProper =
      aiGeneratedScore >= AI_GENERATED_THRESHOLD || newsScore >= NEWS_THRESHOLD;
    console.log("SHOULD HIDE PROPER: ", shouldHideProper);
    return shouldHideProper
  }

  // async function mockBackendRequest(imageUrls) {
  //   console.log(`[AIBot Extension] Sending ${imageUrls.length} images to backend`);
  //   await new Promise(resolve => setTimeout(resolve, 100));
  //   return imageUrls.map(imageUrl => ({
  //     imageUrl,
  //     aiGeneratedScore: Math.floor(Math.random() * 10),
  //     newsScore: Math.floor(Math.random() * 10)
  //   }));
  // }

  async function sendToBackend(claimInputPayload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "ANALYZE_IMAGES", payload: claimInputPayload },
        (response) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          if (!response?.ok)
            return reject(new Error(response?.error || "Unknown error"));
          resolve(response.result);
        },
      );
    });
  }

  async function processPosts() {
    // DEBUG: console.log("[AIBot Extension] Processing posts...");
    const posts = getAllPosts();

    // Filter out posts already processed (converted to placeholder)
    const newPosts = posts.filter(
      (post) => !removedPostUrls.has(post.imageUrl),
    );

    const uncachedPosts = newPosts.filter(
      (post) => !postCache.has(post.imageUrl),
    );
    // DEBUG: console.log(`[AIBot Extension] ${uncachedPosts.length} uncached posts`);

    if (uncachedPosts.length > 0) {
      // Process each post individually by calling the hosted API
      for (const post of uncachedPosts) {
        // Skip if this URL is already being processed
        if (inFlightUrls.has(post.imageUrl)) {
          // DEBUG: console.log(`[AIBot Extension] Skipping ${post.imageUrl.substring(0, 50)}... - already in-flight`);
          continue;
        }

        const payload = {
          url: post.imageUrl,
          caption: post.caption || "",
          alt_text: post.imageAlt || "",
          metadata: {},
          max_images: 3,
        };

        // Mark URL as in-flight before making request
        inFlightUrls.add(post.imageUrl);

        try {
          const result = await sendToBackend(payload);
          console.log("[AIBot Extension] Received API result:");
          console.log(result);

          // Extract scores from AgentOutput response
          // API returns ai_generated_risk_score and misinformation_risk_score as 0.0-1.0 decimals
          const aiGeneratedScore = result.ai_generated_risk_score ?? 0;
          const newsScore = result.misinformation_risk_score ?? 0;
          const hideResult = {
            aiGeneratedScore: aiGeneratedScore,
            newsScore: newsScore,
            shouldHide: shouldHidePost(aiGeneratedScore, newsScore),
          };
          postCache.set(post.imageUrl, hideResult);
          console.log(hideResult);
        } catch (err) {
          console.error("[AIBot Extension] API call failed:", err);
          // Cache with default values to avoid repeated failed calls (0.0-1.0 scale)
          postCache.set(post.imageUrl, {
            aiGeneratedScore: 0.5,
            newsScore: 0.5,
            shouldHide: false,
          });
        } finally {
          // Always remove from in-flight set when done (success or error)
          inFlightUrls.delete(post.imageUrl);
        }
      }
    }

    let newlyRemoved = 0;
    newPosts.forEach((post) => {
      const cachedResult = postCache.get(post.imageUrl);
      // DEBUG: console.log(cachedResult && cachedResult.shouldHide);
      if (cachedResult && cachedResult.shouldHide) {
        // DEBUG: Print posts that should be hidden
        console.log("=== POST SHOULD BE HIDDEN ===");
        console.log("Image URL:", post.imageUrl);
        console.log("AI Score:", cachedResult.aiGeneratedScore);
        console.log("News Score:", cachedResult.newsScore);
        console.log("Element:", post.element);
        console.log("Would substitute with placeholder HTML");
        console.log("==============================");
        removePost(post);
        newlyRemoved++;
      }
    });

    // Update and persist total count
    if (newlyRemoved > 0) {
      totalRemovedCount += newlyRemoved;
      chrome.storage.sync.set({ hiddenCount: totalRemovedCount });
      // DEBUG: console.log(
      //   `[AIBot Extension] Removed ${newlyRemoved} new posts. Total removed: ${totalRemovedCount}`,
      // );
    }
  }

  function getPlaceholderHTML(postId) {
    return `
      <div class="aibot-placeholder" data-post-id="${postId}" style="
        background-image: url('${chrome.runtime.getURL("crime-scene.png")}');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        height: 400px;
        border-radius: 8px;
        margin: 8px 0;
        position: relative;
        overflow: hidden;
      ">
        <button class="aibot-show-btn" style="
          position: absolute;
          top: 12px;
          right: 12px;
          padding: 8px 16px;
          background: #4dabf7;
          color: white;
          border: none;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: background 0.2s;
          z-index: 100;
        " onmouseover="this.style.background='#339af0'" onmouseout="this.style.background='#4dabf7'">Show Post</button>
        <div style="
          width: 100%;
          height: 100%;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.4) 0%,
            rgba(0, 0, 0, 0.65) 40%,
            rgba(0, 0, 0, 0.65) 100%
          );
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
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
        </div>
      </div>
    `;
  }

  function removePost(post) {
    if (post.element && post.imageUrl) {
      removedPostUrls.add(post.imageUrl);

      // Store original content before replacing
      originalPostContent.set(post.imageUrl, post.element.innerHTML);

      // Replace post content with placeholder while keeping the article element
      post.element.innerHTML = getPlaceholderHTML(post.imageUrl);
      post.element.setAttribute("data-aibot-processed", "true");
      post.element.setAttribute("data-aibot-removed", "true");

      // Add click handler to show button
      const showBtn = post.element.querySelector(".aibot-show-btn");
      if (showBtn) {
        showBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          showHiddenPost(post.element, post.imageUrl);
        });
      }

      // Persist to storage
      chrome.storage.sync.set({
        removedPostUrls: Array.from(removedPostUrls),
      });
      // DEBUG: console.log(
      //   "[AIBot Extension] Replaced post with placeholder:",
      //   post.imageUrl.substring(0, 50) + "...",
      // );
    }
  }

  function showHiddenPost(element, imageUrl) {
    const originalContent = originalPostContent.get(imageUrl);
    if (originalContent && element) {
      // Restore original content
      element.innerHTML = originalContent;
      element.setAttribute("data-aibot-temp-visible", "true");
      element.removeAttribute("data-aibot-removed");

      // DEBUG: console.log(
      //   "[AIBot Extension] Temporarily showing post:",
      //   imageUrl.substring(0, 50) + "...",
      // );
    }
  }

  function rehideTempVisiblePosts() {
    const tempVisiblePosts = document.querySelectorAll(
      "article[data-aibot-temp-visible]",
    );
    tempVisiblePosts.forEach((post) => {
      // Find the image URL from the restored content
      let img =
        post.querySelector("div._aagu._aa20 div._aagv img") ||
        post.querySelector('img[alt^="Photo by"]');

      if (!img) {
        const allImages = post.querySelectorAll("img");
        img = Array.from(allImages).find(
          (img) =>
            !img.alt.includes("profile picture") && img.src && img.width > 100,
        );
      }

      const imageUrl = img ? img.src : null;

      if (imageUrl && originalPostContent.has(imageUrl)) {
        // Replace with placeholder again
        post.innerHTML = getPlaceholderHTML(imageUrl);
        post.setAttribute("data-aibot-removed", "true");
        post.removeAttribute("data-aibot-temp-visible");

        // Re-attach click handler
        const showBtn = post.querySelector(".aibot-show-btn");
        if (showBtn) {
          showBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showHiddenPost(post, imageUrl);
          });
        }

        // DEBUG: console.log(
        //   "[AIBot Extension] Re-hidden post after scroll:",
        //   imageUrl.substring(0, 50) + "...",
        // );
      }
    });
  }

  function processSinglePost(postElement) {
    // Early return - skip if already processed, removed, or has placeholder
    if (
      postElement.hasAttribute("data-aibot-processed") ||
      postElement.hasAttribute("data-aibot-removed") ||
      postElement.querySelector(".aibot-placeholder")
    ) {
      return;
    }

    let img = null;

    img = postElement.querySelector("div._aagu._aa20 div._aagv img");

    if (!img) {
      img = postElement.querySelector('img[alt^="Photo by"]');
    }

    if (!img) {
      const allImages = postElement.querySelectorAll("img");
      img = Array.from(allImages).find(
        (img) =>
          !img.alt.includes("profile picture") && img.src && img.width > 100,
      );
    }

    const imageUrl = img ? img.src : null;

    if (!imageUrl) {
      return;
    }

    // Check if this URL should be hidden immediately
    if (removedPostUrls.has(imageUrl)) {
      // Store original content if not already stored
      if (!originalPostContent.has(imageUrl)) {
        originalPostContent.set(imageUrl, postElement.innerHTML);
      }

      postElement.innerHTML = getPlaceholderHTML(imageUrl);
      postElement.setAttribute("data-aibot-processed", "true");
      postElement.setAttribute("data-aibot-removed", "true");

      // Add click handler to show button
      const showBtn = postElement.querySelector(".aibot-show-btn");
      if (showBtn) {
        showBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          showHiddenPost(postElement, imageUrl);
        });
      }

      // DEBUG: console.log(
      //   "[AIBot Extension] Immediately re-hidden known post:",
      //   imageUrl.substring(0, 50) + "...",
      // );
      return;
    }

    // Check cache
    const cachedResult = postCache.get(imageUrl);
    if (cachedResult) {
      if (cachedResult.shouldHide) {
        removedPostUrls.add(imageUrl);

        // Store original content before replacing
        if (!originalPostContent.has(imageUrl)) {
          originalPostContent.set(imageUrl, postElement.innerHTML);
        }

        postElement.innerHTML = getPlaceholderHTML(imageUrl);
        postElement.setAttribute("data-aibot-processed", "true");
        postElement.setAttribute("data-aibot-removed", "true");

        // Add click handler to show button
        const showBtn = postElement.querySelector(".aibot-show-btn");
        if (showBtn) {
          showBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showHiddenPost(postElement, imageUrl);
          });
        }

        chrome.storage.sync.set({
          removedPostUrls: Array.from(removedPostUrls),
        });
        // DEBUG: console.log(
        //   "[AIBot Extension] Replaced cached post with placeholder:",
        //   imageUrl.substring(0, 50) + "...",
        // );
      } else {
        postElement.setAttribute("data-aibot-processed", "true");
        postElement.setAttribute("data-aibot-safe", "true");
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
          if (node.tagName === "ARTICLE") {
            processSinglePost(node);
            newPostsFound = true;
          }
          // Check if the added node contains articles
          if (node.querySelectorAll) {
            const articles = node.querySelectorAll("article");
            articles.forEach((article) => {
              processSinglePost(article);
              newPostsFound = true;
            });
          }
        }
      });
    });

    if (newPostsFound) {
      // Update hidden count after processing new posts
      const currentHidden = document.querySelectorAll(
        "article[data-aibot-removed]",
      ).length;
      if (currentHidden !== totalRemovedCount) {
        totalRemovedCount = currentHidden;
        chrome.storage.sync.set({ hiddenCount: totalRemovedCount });
      }
    }
  });

  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  let scrollTimeout;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Re-hide any temporarily visible posts
      rehideTempVisiblePosts();
      processPosts();
    }, SCROLL_DEBOUNCE_MS);
  });

  processPosts();
})();
