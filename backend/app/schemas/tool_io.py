from __future__ import annotations
from typing import Annotated, Any, Dict, List, Optional
from pydantic import BaseModel, Field, HttpUrl, conint, confloat

class WebSearchInput(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: Annotated[float, Field(ge=1.0, le=10.0)] = Field(default=5)

class WebSearchResult(BaseModel):
    title:Optional[str] = None
    url: HttpUrl
    snipped: Optional[str] = None

class WebSearchOutput(BaseModel):
    query: str
    results: List[WebSearchResult] = Field(default_factory=list)

class FetchExtractInput(BaseModel):
    url:HttpUrl

class FetchExtractOutput(BaseModel):
    url: HttpUrl
    title: Optional[str] = None
    clean_text: str = Field(..., min_length=1, description="Cleaned text extracted content")

class CredibilityItem(BaseModel):
    url: HttpUrl
    domain:str
    tier: str = Field(..., description="high|medium|low")
    rationale: Optional[str] = None

class CredibilityOutput(BaseModel):
    items: List[CredibilityItem] = Field(default_factory=list)

class NumericVerifyInput(BaseModel):
    claim_text: str= Field(..., min_length=1)

class NumericFinding(BaseModel):
    extracted_numbers: List[str] = Field(default_factory=list, description="Raw numeric strings found")
    flags: List[str] = Field(default_factory=list, description="Issues found (unit mismatch, impossible scale, etc.).")
    computed_checks: Dict[str, Any] = Field(default_factory=dict, description="Any computed values used for verification.")
    score: Annotated[float, Field(ge=0.0, le=1.0)] = Field(
        default=0.0,
        description="How suspicious the numerical component is (0=clean, 1=very suspicious).",
    )

class NumericVerifyOutput(BaseModel):
    claim_text: str
    finding: NumericFinding