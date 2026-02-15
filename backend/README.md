# Backend (OCR Extractor MVP)

This folder contains an MVP Python script that extracts text from social media post images for LLM parsing.

## What it does

- Accepts `post_url` + `caption`
- Tries to collect image URLs from the page
- Uses OCR to extract text from images
- Optionally appends caption to OCR text for a single LLM input payload

## Setup

1. Install Python 3.10+
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Install Tesseract OCR (required by `pytesseract`):
   - Windows: install from UB Mannheim build or official installer
   - Ensure `tesseract` is in PATH

## Run

```bash
python app/post_classifier.py --url "https://example.com/post" --caption "caption text here" --include-caption
```

Output is JSON with OCR text, `llm_input_text` (OCR only or caption + OCR), and detected image URLs.