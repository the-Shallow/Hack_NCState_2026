import argparse
import io
import json
import re
from dataclasses import asdict, dataclass
from typing import List
from urllib.parse import urljoin, urlparse

import pytesseract
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageEnhance, ImageOps

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)


@dataclass
class ExtractedTextResult:
    url: str
    caption: str
    include_caption: bool
    ocr_text: str
    llm_input_text: str
    image_urls: List[str]
    ocr_errors: List[str]


def _session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    return sess


def _is_image_url(url: str) -> bool:
    parsed = urlparse(url)
    return bool(re.search(r"\.(png|jpe?g|webp|bmp)$", parsed.path.lower()))


def _extract_image_urls(post_url: str, max_images: int = 3) -> List[str]:
    if _is_image_url(post_url):
        return [post_url]

    sess = _session()
    response = sess.get(post_url, timeout=15)
    response.raise_for_status()

    content_type = response.headers.get("content-type", "").lower()
    if content_type.startswith("image/"):
        return [post_url]

    soup = BeautifulSoup(response.text, "html.parser")
    candidates: List[str] = []

    for attr in [("property", "og:image"), ("name", "twitter:image")]:
        tag = soup.find("meta", attrs={attr[0]: attr[1]})
        if tag and tag.get("content"):
            candidates.append(urljoin(post_url, tag["content"]))

    for img in soup.find_all("img", src=True):
        candidates.append(urljoin(post_url, img["src"]))

    seen = set()
    image_urls: List[str] = []
    for candidate in candidates:
        if candidate not in seen and ("instagram" in candidate or _is_image_url(candidate)):
            seen.add(candidate)
            image_urls.append(candidate)
        if len(image_urls) >= max_images:
            break

    return image_urls


def _download_image(url: str) -> Image.Image:
    sess = _session()
    response = sess.get(url, timeout=15)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def _preprocess_for_ocr(image: Image.Image, ocr_profile: str) -> List[Image.Image]:
    resized = image.resize(
        (max(1, image.width * 2), max(1, image.height * 2)),
        Image.Resampling.LANCZOS,
    )
    gray = ImageOps.grayscale(resized)
    boosted_contrast = ImageEnhance.Contrast(gray).enhance(2.0)
    autocontrast = ImageOps.autocontrast(boosted_contrast)
    thresholded = autocontrast.point(lambda value: 0 if value < 180 else 255)
    if ocr_profile == "fast":
        return [autocontrast, thresholded]

    inverted = ImageOps.invert(autocontrast)
    inverted_thresholded = inverted.point(lambda value: 0 if value < 180 else 255)
    red_channel, green_channel, blue_channel = resized.split()
    return [
        resized,
        gray,
        autocontrast,
        thresholded,
        inverted,
        inverted_thresholded,
        ImageOps.autocontrast(red_channel),
        ImageOps.autocontrast(green_channel),
        ImageOps.autocontrast(blue_channel),
    ]


def _ocr_psm_modes(ocr_profile: str) -> tuple[str, ...]:
    if ocr_profile == "fast":
        return ("--psm 6",)
    return ("--psm 6", "--psm 11")


def _ocr_text_score(text: str) -> int:
    stripped = text.strip()
    if not stripped:
        return 0
    alnum_count = sum(char.isalnum() for char in stripped)
    word_count = len(re.findall(r"[A-Za-z0-9]{2,}", stripped))
    non_empty_lines = len([line for line in stripped.splitlines() if line.strip()])
    return alnum_count + (word_count * 3) + non_empty_lines


def _line_quality_score(line: str) -> int:
    alpha_count = sum(char.isalpha() for char in line)
    digit_count = sum(char.isdigit() for char in line)
    symbol_count = sum(not char.isalnum() and not char.isspace() for char in line)
    word_count = len(re.findall(r"[A-Za-z]{2,}", line))
    return (alpha_count * 2) + digit_count + (word_count * 3) - (symbol_count * 2)


def _is_reasonable_ocr_line(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) < 6:
        return False
    alpha_count = sum(char.isalpha() for char in stripped)
    if alpha_count < 4:
        return False
    symbol_count = sum(not char.isalnum() and not char.isspace() for char in stripped)
    if symbol_count > max(4, len(stripped) // 4):
        return False
    return _line_quality_score(stripped) >= 12


def _extract_best_text_from_image(image: Image.Image, ocr_profile: str) -> str:
    candidates: List[str] = []
    for processed in _preprocess_for_ocr(image, ocr_profile=ocr_profile):
        for psm_mode in _ocr_psm_modes(ocr_profile):
            text = pytesseract.image_to_string(processed, config=psm_mode).strip()
            if text:
                candidates.append(text)
    if not candidates:
        return ""
    merged_lines: List[str] = []
    seen_normalized: set[str] = set()
    scored_candidates = sorted(candidates, key=_ocr_text_score, reverse=True)
    for candidate in scored_candidates:
        for raw_line in candidate.splitlines():
            line = raw_line.strip()
            if not _is_reasonable_ocr_line(line):
                continue
            normalized = re.sub(r"[^a-z0-9]", "", line.lower())
            if len(normalized) < 4 or normalized in seen_normalized:
                continue
            seen_normalized.add(normalized)
            merged_lines.append(line)
            if len(merged_lines) >= 12:
                return "\n".join(merged_lines)
    if merged_lines:
        return "\n".join(merged_lines)
    return scored_candidates[0]


def _extract_ocr_text(image_urls: List[str], ocr_profile: str) -> tuple[str, List[str]]:
    chunks: List[str] = []
    errors: List[str] = []
    for image_url in image_urls:
        try:
            image = _download_image(image_url)
            text = _extract_best_text_from_image(image, ocr_profile=ocr_profile)
            if text.strip():
                chunks.append(text.strip())
        except Exception as exc:
            errors.append(f"{image_url} -> {type(exc).__name__}: {exc}")
            continue
    return "\n".join(chunks), errors


def extract_post_text_for_llm(
    post_url: str,
    caption: str = "",
    include_caption: bool = False,
    max_images: int = 3,
    ocr_profile: str = "fast",
) -> ExtractedTextResult:
    if ocr_profile not in {"fast", "accurate"}:
        raise ValueError("ocr_profile must be either 'fast' or 'accurate'")
    image_urls = _extract_image_urls(post_url, max_images=max_images)
    ocr_text, ocr_errors = _extract_ocr_text(image_urls, ocr_profile=ocr_profile)
    if include_caption and caption.strip():
        llm_input_text = "\n\n".join([caption.strip(), ocr_text.strip()]).strip()
    else:
        llm_input_text = ocr_text.strip()

    return ExtractedTextResult(
        url=post_url,
        caption=caption,
        include_caption=include_caption,
        ocr_text=ocr_text,
        llm_input_text=llm_input_text,
        image_urls=image_urls,
        ocr_errors=ocr_errors,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract OCR text from a social post for LLM parsing."
    )
    parser.add_argument("--url", required=True, help="Post URL or direct image URL")
    parser.add_argument("--caption", default="", help="Optional post caption text")
    parser.add_argument(
        "--include-caption",
        action="store_true",
        help="Append caption to OCR text in llm_input_text",
    )
    parser.add_argument("--max-images", type=int, default=3, help="Max images to OCR")
    parser.add_argument(
        "--ocr-profile",
        choices=["fast", "accurate"],
        default="fast",
        help="OCR pass profile: fast is quicker with fewer OCR variants; accurate runs more variants",
    )
    args = parser.parse_args()

    result = extract_post_text_for_llm(
        post_url=args.url,
        caption=args.caption,
        include_caption=args.include_caption,
        max_images=args.max_images,
        ocr_profile=args.ocr_profile,
    )
    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()