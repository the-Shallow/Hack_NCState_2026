chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ANALYZE_IMAGES") {
    analyzeImages(msg.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // IMPORTANT: keep the message channel open for async
  }
});

async function analyzeImages(payload) {
  console.log("=== SENDING FETCH REQUEST ===");
  console.log("URL:", "https://hack-ncstate-2026.onrender.com/api/analyze_claims");
  console.log("Payload:", payload);
  console.log("============================");
  
  const resp = await fetch("https://hack-ncstate-2026.onrender.com/api/analyze_claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Backend ${resp.status}: ${text}`);
  }
  return await resp.json();
}
