import re
from typing import Any, Dict, List

from app.schemas.tool_io import NumericVerifyInput, NumericVerifyOutput, NumericFinding


_NUM_RE = re.compile(
    r"""
    (?:
        (?P<currency>\$)\s*(?P<cur_num>\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?) |
        (?P<percent>\d+(?:\.\d+)?)\s*(?P<pct_sign>%) |
        (?P<number>\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)
    )
    """,
    re.VERBOSE,
)

_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)", re.IGNORECASE)


def _extract_numeric_strings(text: str) -> List[str]:
    found: List[str] = []
    for m in _NUM_RE.finditer(text):
        s = m.group(0).strip()
        if s:
            found.append(s)
    return found


def _to_float(num_str: str) -> float:
    return float(num_str.replace(",", "").replace("$", "").replace("%", "").strip())


def numeric_verify(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool entrypoint: accepts dict (from Backboard tool call args),
    validates via Pydantic, returns JSON-serializable dict output.
    """
    inp = NumericVerifyInput(**payload)
    claim = inp.claim_text

    extracted = _extract_numeric_strings(claim)
    flags: List[str] = []
    computed: Dict[str, Any] = {}

    # Flag suspicious "too precise" or "absolute certainty" patterns
    lowered = claim.lower()
    if any(k in lowered for k in ["100%", "guaranteed", "no risk", "always", "never"]):
        flags.append("contains_absolute_or_guarantee_language")

    # Percent sanity checks
    percents = []
    for s in extracted:
        if "%" in s:
            try:
                val = _to_float(s)
                percents.append(val)
            except Exception:
                continue

    for p in percents:
        if p < 0 or p > 100:
            flags.append("percent_out_of_range")

    # Detect suspicious ranges like "90-95%" / "10 to 12"
    range_matches = _RANGE_RE.findall(claim)
    if range_matches:
        ranges = []
        for a, b in range_matches:
            try:
                fa, fb = float(a), float(b)
                lo, hi = min(fa, fb), max(fa, fb)
                ranges.append((lo, hi))
            except Exception:
                continue
        if ranges:
            computed["ranges"] = ranges

    # Heuristic: huge currency amounts mentioned with urgency often correlate with scams
    if "$" in claim and any(k in lowered for k in ["today", "now", "urgent", "limited time", "within"]):
        flags.append("currency_with_urgency_pattern")

    # Heuristic numeric suspiciousness score
    # 0.0 clean → 1.0 very suspicious
    score = 0.0
    if flags:
        score = min(1.0, 0.15 * len(flags) + (0.2 if any("out_of_range" in f for f in flags) else 0.0))

    out = NumericVerifyOutput(
        claim_text=claim,
        finding=NumericFinding(
            extracted_numbers=extracted,
            flags=flags,
            computed_checks=computed,
            score=score,
        ),
    )
    return out.model_dump()
