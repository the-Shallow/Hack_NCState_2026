from datetime import datetime, timezone
import json
from time import timezone
from typing import Any, Dict, List, Optional
from backboard import BackboardClient
from pydantic import BaseModel, ValidationError
from app.agents.prompts import SYSTEM_PROMPT
from app.schemas.agent_io import AgentContext, AgentOutput, ClaimInput, Verdict
from app.tools.registry import get_tool_definitions, build_tool_registry


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json_load(x: Any) -> Any:
    if isinstance(x, str):
        return json.loads(x)
    return x

def extract_evidence_items_tools_output(
        tool_name: str,
        tool_output: Dict[str, Any],
        claim_id_hint: Optional[str] = None
) -> List[Dict[str, Any]]:
    evidence : List[Dict[str, Any]] = []

    if tool_name == "web_search_llm":
        selected = tool_output.get("selected", []) or []
        print(f"Extracting evidence from web_search_llm output, selected items: {selected}")
        for item in selected:
            evidence.append(
                {
                    "claim_id": int(claim_id_hint or 0),
                    "source_url": item.get("url"),
                    "source_credibility": None,  # filled later via credibility tool
                    "title": item.get("title"),
                    # "retrieved_at": _now_iso(),
                    "summary": item.get("evidence_summary") or item.get("snippet") or "",
                    "supporting": True,  # unknown polarity at search stage; synthesis can reinterpret
                }
            )
        return evidence
    elif tool_name == "credibility_llm":
        # expected: {"items":[{url,domain,tier,rationale,signals}]}
        # This tool doesn't create evidence; it annotates credibility.
        # We return empty; caller will use this output to enrich evidence.
        return []
    
def _apply_credibility_to_evidence(
    evidence: List[Dict[str, Any]],
    credibility_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Attach credibility tier to evidence entries by URL match.
    """
    tier_by_url: Dict[str, str] = {}
    for it in credibility_items:
        url = it.get("url")
        tier = it.get("tier")
        if url and tier:
            tier_by_url[str(url)] = str(tier)

    for ev in evidence:
        u = ev.get("source_url")
        if u and str(u) in tier_by_url:
            ev["source_credibility"] = tier_by_url[str(u)]
    return evidence

def _tc_id(tc):
    return tc.get("id") if isinstance(tc, dict) else tc.id

def _tc_name(tc):
    if isinstance(tc, dict):
        return (tc.get("function") or {}).get("name")
    return tc.function.name

def _tc_args_str(tc):
    if isinstance(tc, dict):
        return (tc.get("function") or {}).get("arguments") or "{}"
    return tc.function.arguments

def _tc_parsed_args(tc):
    # Some SDKs provide parsed arguments; dict format usually doesn't.
    if not isinstance(tc, dict):
        return getattr(tc.function, "parsed_arguments", None)
    return None


class BackboardAgent:
    def __init__(self, api_key:str, model_name:str = "gpt-5-mini"):
        self.client = BackboardClient(api_key=api_key)
        self.model_name = model_name

    async def ensure_assistant(self):
        tools = get_tool_definitions()
        print(tools)
        assistant = await self.client.create_assistant(
            name=f"Backboard_agent",
            description= SYSTEM_PROMPT,
            tools = tools,
        )

        print(f"Created assistant with ID: {assistant.assistant_id}")
        self.assistant_id = assistant.assistant_id
        return self.assistant_id
    

    async def run(self, inp: ClaimInput, assistant_id: Optional[str] = None) -> AgentOutput:
        tool_registry = build_tool_registry(client=self.client)
        assistant_id = await self.ensure_assistant()

        # if not assistant_id:
            # assistant_id = await self.ensure_assistant()
        
        thread = await self.client.create_thread(
            assistant_id=assistant_id
        )

        thread_id = thread.thread_id
        message_payload : Dict[str, Any] = {
            "claims": inp.claims,
        }

        if inp.context:
            message_payload["context"] = inp.context.model_dump()
        
        print(message_payload)
        resp = await self.client.add_message(
            thread_id=thread_id,
            content=json.dumps(message_payload, default=str),
            stream=False,
            memory="off",
            model_name=self.model_name,
        )

        print(f"Initial response: {resp}")

        tool_rounds = 0
        working_evidence: List[Dict[str, Any]] = []
        credibility_cache: List[Dict[str, Any]] = []

        while getattr(resp, "status", None) == "REQUIRES_ACTION" and getattr(resp, "tool_calls", None):
            tool_rounds += 1
            outputs = []

            for tc in resp.tool_calls:
                # fn_name = tc.function.name
                fn_name = _tc_name(tc)
                args_str = _tc_args_str(tc)
                print(f"Tool call: {fn_name} with arguments: {args_str}")
                
                # if fn_name not in tool_registry:
                #     out = {"error": f"Tool {fn_name} not found"}
                # else:
                #     args = getattr(tc.function,  "parsed_arguments", None)

                if fn_name is None:
                    out = {"error": "Malformed tool call: missing function.name"}
                    tool_call_id = _tc_id(tc)
                    outputs.append({"tool_call_id": tool_call_id, "output": json.dumps(out)})
                    continue

                args = _tc_parsed_args(tc)
                if args is None:
                    args = json.loads(args_str)

                claim_id_hint = args.get("claim_id") if isinstance(args, dict) else None
                
                try:
                    out = await tool_registry[fn_name](args)
                except Exception as e:
                    out = {"error": f"Tool {fn_name} execution error"}

                out_dict = _safe_json_load(out)
                if fn_name == "credibility_llm":
                    credibility_cache.extend(out_dict.get("items", []) or [])
                else:
                    working_evidence.extend(
                        extract_evidence_items_tools_output(
                            tool_name=fn_name,
                            tool_output=out_dict,
                            claim_id_hint=claim_id_hint,
                        )
                    )
                outputs.append({
                    "tool_call_id":  _tc_id(tc),
                    "output": json.dumps(out)
                })

            resp = await self.client.submit_tool_outputs(
                thread_id=thread_id,
                run_id=resp.run_id,
                tool_outputs=outputs
            )

        
        if credibility_cache and working_evidence:
            working_evidence = _apply_credibility_to_evidence(working_evidence, credibility_cache)

        evidence_bundle = {
            "claims": [{"claim_id": i, "text": c} for i, c in enumerate(inp.claims)],
            "evidence": working_evidence,
            "credibility_items": credibility_cache,
        }

        synthesis_message = (
            "You are now in STAGE 3 (Evidence Synthesis and Conclusion Generation).\n\n"
            "Use ONLY the EVIDENCE_BUNDLE below (do not add outside facts).\n"
            "Do the following strictly:\n"
            "1) Group evidence by claim_id.\n"
            "2) Separate supporting vs contradicting evidence.\n"
            "3) Resolve conflicts using credibility tier if available (high > medium > low).\n"
            "4) Build reasoning_chain that explicitly links evidence to the conclusion.\n"
            "5) Produce the final JSON report in the required output schema.\n\n"
            "EVIDENCE_BUNDLE:\n"
            f"{json.dumps(evidence_bundle, ensure_ascii=False)}"
        )

        resp2 = await self.client.add_message(
            thread_id=thread_id,
            content=synthesis_message,
            stream=False,
            memory="off",
            model_name=self.model_name,
        )

        print(f"Synthesis response: {resp2}")


        raw = getattr(resp2, "content" , None)
        if raw is None:
            raise RuntimeError("Backboard returned no content in synthesis response.")

        data = _safe_json_load(raw)

        # Ensure tool_rounds is set (model may or may not include it)
        if isinstance(data, dict):
            data.setdefault("tool_rounds", tool_rounds)
        else:
            raise RuntimeError(f"Expected dict JSON output, got: {type(data)}")

        # if "tool_rounds" not in data:
        #     data["tool_rounds"] = tool_rounds

        try:
            return AgentOutput(**data)
        except ValidationError as e:
            raise RuntimeError(f"Agent output failed schema validation:\n{e}\nOutput:\n{json.dumps(data, indent=2)}")