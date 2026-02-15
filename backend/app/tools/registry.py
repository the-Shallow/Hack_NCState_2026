from typing import Any, Awaitable, Callable, Dict, List, Type
from app.tools.numeric_verify import numeric_verify
from app.tools.web_search_tool import WebSearchTool
from app.tools.credibility_tool import CredibilityTool
from backboard import BackboardClient


ToolFn = Callable[[Dict[str,Any]], Awaitable[Dict[str, Any]]]


def get_tool_definitions():
    print("Getting tool definitions...")
    tools : List[Dict[str, Any]] = [
        {
            "type": "function",
            "function": {
                "name": "web_search_llm",
                "description": "LLM-assisted web search: generates queries to search on web, retrieves results, selects best evidence candidates from snippets.",
                "parameters": {
                "type": "object",
                "properties": {
                    "claim_text": {"type": "string"},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 10},
                    "prior_queries": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["claim_text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "credibility_llm",
                "description": "LLM-based credibility tiering for sources using url/title/snippet.",
                "parameters": {
                "type": "object",
                "properties": {
                    "sources": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                        "url": {"type": "string"},
                        "title": {"type": "string"},
                        "snippet": {"type": "string"}
                        },
                        "required": ["url"]
                    }
                    }
                },
                "required": ["sources"]
                }
            }
        }


    ]

    print(f"Defined {len(tools)} tools.")
    return tools

def build_tool_registry(client:BackboardClient) -> Dict[str, ToolFn]:
    registry: Dict[str, ToolFn] = {}

    async def _numeric(args:Dict[str, Any]) -> Dict[str, Any]:
        return numeric_verify(args)
    
    registry["numeric_verify"] = _numeric

    search_tool = WebSearchTool(client)
    async def _web_search(args:Dict[str, Any]) -> Dict[str, Any]:
        return await search_tool.run(args)
    
    registry["web_search_llm"] = _web_search

    cred_tool = CredibilityTool(client)

    async def _credibility(args:Dict[str, Any]) -> Dict[str, Any]:
        return await cred_tool.run(args)

    registry["credibility_llm"] = _credibility

    return registry

# def get_tool_registry() -> Dict[str, ToolFn]:
#     registry: Dict[str, ToolFn] = {
#         "numeric_verify": numeric_verify
#     }

#     return registry