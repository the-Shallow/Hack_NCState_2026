import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from backboard import BackboardClient
from app.agents.prompts import CREDIBILITY_TOOL_PROMPT

def _domain(u: str) -> str:
    return (urlparse(u).netloc or "").lower().replace("www.", "")

class CredibilityTool:
    def __init__(self,  client: BackboardClient, model_name: str ="gpt-4o"):
        self.client = client
        self.model_name = model_name
        self.assistant_id: Optional[str] = None
    
    async def ensure_assistant(self):
        if self.assistant_id:
            return self.assistant_id
        
        a = await self.client.create_assistant(
            name="CredibilityTool",
            description=CREDIBILITY_TOOL_PROMPT,
            tools=[]
        )

        self.assistant_id = a.assistant_id
        return self.assistant_id

    async def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        assistant_id = await self.ensure_assistant()
        thread = await self.client.start_thread(
            assistant_id=assistant_id,
        )

        sources = payload.get("sources", [])
        normalized = []
        for s in sources:
            url = s.get("url")
            if not url:
                continue
            normalized.append(
                {
                    "url": url,
                    "domain": _domain(url),
                    "title": s.get("title"),
                    "snippet": s.get("snippet"),
                }
            )
        
        msg = {
            "sources": normalized
        }

        resp = await self.client.add_message(
            thread_id=thread.thread_id,
            content=json.dumps(msg),
            stream=False,
            memory="off",
            model_name=self.model_name
        )

        raw = resp.content
        if isinstance(raw, str):
            data = json.loads(raw)
        else:
            data = raw

        return data
    
    