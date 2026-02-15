import json
import re
from typing import Any, Dict, List, Optional
import requests
import os
import httpx
from backboard import BackboardClient
from app.agents.prompts import WEB_SEARCH_TOOL_PROMPT


_DDG_URL = "https://duckduckgo.com/html/"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Agent/1.0"

def ddg_search(query:str, top_k:int=5):
    r = requests.post(_DDG_URL, data={
        "q" : query
    }, headers={
        "User-Agent": _UA
    }, timeout=12)
    r.raise_for_status()
    html = r.text
    link_re = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE)
    snippet_re = re.compile(
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>|<div[^>]+class="result__snippet"[^>]*>(.*?)</div>',
        re.IGNORECASE,
    )

    links = link_re.findall(html)
    snippets = snippet_re.findall(html)

    results: List[Dict[str,str]] = []
    for i, (url, title) in enumerate(links):
        if len(results) >= top_k:
            break

        title = re.sub("<.*?>", "", title).strip()
        snippet = ""
        if i < len(snippets):
            snippet_raw = snippets[i][0] or snippets[i][1] or ""
            snippet = re.sub("<.*?>", "", snippet_raw).strip()
        results.append({"url": url, "title": title, "snippet": snippet})
    return results


BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

async def brave_search(query: str, top_k: int = 5) -> List[Dict[str, str]]:
    api_key = os.getenv("BRAVE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing BRAVE_API_KEY env var")

    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": api_key,
        "User-Agent": _UA,
    }
    params = {
        "q": query,
        "count": min(top_k, 10),  # Brave supports up to 20; keep small for cost
        "safesearch": "moderate",
        # optional knobs:
        # "country": "US",
        # "search_lang": "en",
        # "freshness": "week",  # day|week|month|year
    }

    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(BRAVE_SEARCH_URL, headers=headers, params=params)

    print("Brave status:", r.status_code, "query:", query)
    # Don’t crash your whole pipeline on rate limit; return empty gracefully
    if r.status_code == 429:
        return []

    r.raise_for_status()
    data = r.json()

    items = []
    # Brave’s results usually live under: data["web"]["results"]
    for res in (data.get("web", {}) or {}).get("results", [])[:top_k]:
        url = res.get("url")
        title = res.get("title") or ""
        snippet = res.get("description") or ""
        if url:
            items.append({"url": url, "title": title, "snippet": snippet})
    return items

class WebSearchTool:
    def __init__(self, client: BackboardClient, model_name:str = "gpt-4o"):
        self.client = client
        self.model_name = model_name
        self.assistant_id : Optional[str] = None


    async def ensure_assistant(self):
        if self.assistant_id:
            return self.assistant_id
        
        a = await self.client.create_assistant(
            name="WebSearchTool",
            description=WEB_SEARCH_TOOL_PROMPT,
            tools=[]
        )

        self.assistant_id = a.assistant_id
        return self.assistant_id
    
    async def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        claim_text = payload.get("claim_text", "").strip()
        if not claim_text:
            return {"queries": [], "selected": [], "notes": ["missing claim text"]}
        
        top_k = payload.get("top_k",5)
        prior_queries = payload.get("prior_queries", []) or []
        assistant_id = await self.ensure_assistant()
        thread = await self.client.create_thread(assistant_id=assistant_id)

        resp1 = await self.client.add_message(
            thread_id=thread.thread_id,
            content= json.dumps({
                "claim_text": claim_text,
                    "prior_queries": prior_queries,
                    "search_results": [],
            }),
            stream=False,
            memory="off",
            model_name=self.model_name
        )

        print(f"Planning response: {resp1}")
        plan = json.loads(resp1.content) if isinstance(resp1.content, str) else resp1.content
        print(f"Parsed plan: {plan}")
        queries = plan.get("queries", [])
        if not queries:
            # fallback query
            queries = [claim_text[:120]]

        print(f"Generated queries: {queries}")
        
        queries = queries[:2]
        merged:Dict[str, Dict[str,str]] = {}
        for q in queries:
            for item in await brave_search(q, top_k=top_k):
                merged[item["url"]] = item
        
        results = list(merged.values())

        resp2 = await self.client.add_message(
            thread_id=thread.thread_id,
            content=json.dumps({
                "claim_text": claim_text,
                    "prior_queries": prior_queries,
                    "search_results": results,
            }),
            stream=False,
            memory="off",
            model_name=self.model_name
        )

        print(f"Selection response: {resp2}")

        selection = json.loads(resp2.content) if isinstance(resp2.content, str) else resp2.content

        selection["queries"] = queries
        selection.setdefault("notes", [])
        selection["notes"].append(f"retrieved_results={len(results)}")
        print(f"Final selection: {selection}")
        return selection

