from __future__ import annotations
from enum import Enum
from typing import Annotated, Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, HttpUrl, conlist, confloat

class Verdict(str, Enum):
    likely_true = "likely_true"
    likely_false = "likely_false"
    mixed = "mixed"
    unverifiable = "unverifiable"

class AgentContext(BaseModel):
    caption: Optional[str] = None
    ocr_text: Optional[str] = None
    urls: Optional[List[HttpUrl]] = Field(default_factory=list)
    metadata: Optional[Dict[str,Any]] = Field(default_factory=dict)

class ClaimInput(BaseModel):
    claims: Annotated[List[str], Field(min_length=1)] = Field(..., description="List of claims to assess.")
    context: Optional[AgentContext] = None
    request_id: Optional[str] = Field(default=None, description="Optional trace id from your API layer.")

class EvidenceInput(BaseModel):
    claim_id: int = Field(..., ge=0)
    source_url : Optional[HttpUrl] = None
    source_credibility: Optional[str] = Field(
        default=None, description="high|medium|low or a numeric tier if you prefer later."
    )
    title:Optional[str] = None


class AgentOutput(BaseModel):
    ai_generated_risk_score: Annotated[float, Field(ge=0.0, le=1.0)] = Field(..., description="Risk image/video/text is AI-generated")
    misinformation_risk_score: Annotated[float, Field(ge=0.0, le=1.0)] = Field(..., description="Risk claim is misleading or false")
    verdict: Verdict = Field(..., description="Overall verdict of the claim.")
    confidence: Annotated[float, Field(ge=0.0, le=1.0)] = Field(..., description="Confidence in the verdict.")
    reasoning_chain: List[str] = Field(
        default_factory=list, 
        description="Step by step reasoning statements (short)"
    )
    evidence: List[EvidenceInput] = Field(
        default_factory=list,
        description="Evidence items used in synthesis."
    )
    uncertainties: List[str] = Field(
        default_factory=list,
        description="What could not be verified or was uncertain."
    )