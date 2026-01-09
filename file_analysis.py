import os
import re
import csv
from dataclasses import dataclass
from typing import List, Optional, Tuple

import pytesseract
from pdf2image import convert_from_path
from docx import Document
from pypdf import PdfReader

from lingua import Language, LanguageDetectorBuilder

# Pillow safety limit can massively slow down OCR on large scanned pages by emitting
# DecompressionBombWarning repeatedly. For local batch processing, we disable the limit.
try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
except Exception:
    pass

LANGS = [Language.ENGLISH, Language.RUSSIAN, Language.UKRAINIAN]
detector = LanguageDetectorBuilder.from_languages(*LANGS).build()

EN = Language.ENGLISH

TRANSLATION_CUES = [
    r"\btranslation\b",
    r"\benglish translation\b",
    r"\bcertified translation\b",
    r"\btranslator\b",
    r"\bcertificate of translation\b",
    r"\bi certify\b.*\btranslation\b",
]

# === Performance knobs (tune as needed) ===
# Most scanned PDFs: OCR only a subset of pages for fast triage.
OCR_DPI = 200
OCR_FIRST_N_PAGES = 3
OCR_LAST_N_PAGES = 2
TESSERACT_LANG = "eng+rus+ukr"
TESSERACT_CONFIG = r"--oem 1 --psm 6"

def normalize(s: str) -> str:
    s = s.replace("\x00", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def has_cue(text: str) -> bool:
    return any(re.search(p, text, flags=re.I) for p in TRANSLATION_CUES)

def detect_lang(text: str) -> Optional[Language]:
    text = normalize(text)
    if len(text) < 60:
        return None
    return detector.detect_language_of(text)

def read_docx_text(path: str) -> str:
    doc = Document(path)
    parts = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n".join(parts)

def read_pdf_text_pages(path: str) -> List[str]:
    # Works for text PDFs
    reader = PdfReader(path)
    pages = []
    for p in reader.pages:
        pages.append(p.extract_text() or "")
    return pages

def read_pdf_text_sample(path: str, max_pages: int = 2) -> List[str]:
    """
    Faster than reading all pages: only extracts text from the first N pages to decide
    whether the PDF is text-based or scanned.
    """
    reader = PdfReader(path)
    pages = []
    for i, p in enumerate(reader.pages):
        if i >= max_pages:
            break
        pages.append(p.extract_text() or "")
    return pages

def ocr_pdf_pages(path: str, dpi: int = OCR_DPI, first_n: int = OCR_FIRST_N_PAGES, last_n: int = OCR_LAST_N_PAGES) -> List[str]:
    """
    Works for scanned PDFs.
    Performance: OCR only first_n + last_n pages (instead of all pages).
    """
    # Get page count cheaply
    try:
        n_pages = len(PdfReader(path).pages)
    except Exception:
        n_pages = None

    # Decide which pages to OCR (1-based indexing for pdf2image)
    page_numbers: List[int] = []
    if n_pages:
        page_numbers.extend(range(1, min(first_n, n_pages) + 1))
        if last_n > 0:
            start_last = max(1, n_pages - last_n + 1)
            page_numbers.extend(range(start_last, n_pages + 1))
        # de-dupe while preserving order
        seen = set()
        page_numbers = [p for p in page_numbers if not (p in seen or seen.add(p))]
    else:
        page_numbers = list(range(1, first_n + 1))

    first_page = min(page_numbers)
    last_page = max(page_numbers)

    # pdf2image returns a continuous range; slice down to the specific pages we want
    images = convert_from_path(path, dpi=dpi, first_page=first_page, last_page=last_page)
    wanted_idxs = [p - first_page for p in page_numbers]
    images = [images[i] for i in wanted_idxs if 0 <= i < len(images)]

    out: List[str] = []
    for img in images:
        txt = pytesseract.image_to_string(img, lang=TESSERACT_LANG, config=TESSERACT_CONFIG)
        out.append(txt)
    return out

def is_mostly_empty(pages: List[str]) -> bool:
    # If extraction yields almost nothing, treat as scanned
    total = sum(len(normalize(p)) for p in pages)
    return total < 400  # heuristic threshold

@dataclass
class Result:
    file: str
    kind: str
    overall: str
    en_pages: int
    ru_pages: int
    ua_pages: int
    unknown_pages: int
    likely_translation: str
    notes: str

def analyze_pages(pages: List[str]) -> Tuple[str, int, int, int, int, bool, str]:
    # per-page language distribution + translation heuristic
    langs: List[Optional[Language]] = []
    cues = False
    for p in pages:
        p2 = normalize(p)
        if not p2:
            langs.append(None)
            continue
        cues = cues or has_cue(p2)
        langs.append(detect_lang(p2))

    en = sum(1 for l in langs if l == Language.ENGLISH)
    ru = sum(1 for l in langs if l == Language.RUSSIAN)
    ua = sum(1 for l in langs if l == Language.UKRAINIAN)
    unk = sum(1 for l in langs if l is None)

    # overall = most common non-None
    counts = {Language.ENGLISH: en, Language.RUSSIAN: ru, Language.UKRAINIAN: ua}
    overall_lang = max(counts, key=lambda k: counts[k])
    overall = overall_lang.name if counts[overall_lang] > 0 else "UNKNOWN"

    # translation heuristic:
    # - see RU/UA on earlier pages
    # - then EN later
    # - plus cue words boosts confidence (optional)
    saw_non_en = False
    saw_en_after = False
    for l in langs:
        if l in (Language.RUSSIAN, Language.UKRAINIAN):
            saw_non_en = True
        if saw_non_en and l == Language.ENGLISH:
            saw_en_after = True
            break
    likely_translation = saw_non_en and saw_en_after and (cues or True)

    notes = []
    if cues:
        notes.append("translation_cue_words")
    if saw_non_en and saw_en_after:
        notes.append("non_en_then_en_pages")
    return overall, en, ru, ua, unk, likely_translation, ",".join(notes)

def scan_file(path: str) -> Result:
    ext = os.path.splitext(path)[1].lower()

    if ext == ".docx":
        text = read_docx_text(path)
        # chunk docx into pseudo-pages
        chunks = [text[i:i+2500] for i in range(0, len(text), 2500)]
        overall, en, ru, ua, unk, likely_translation, notes = analyze_pages(chunks)
        return Result(os.path.basename(path), "docx", overall, en, ru, ua, unk,
                      "yes" if likely_translation else "no", notes)

    if ext == ".pdf":
        # Fast path: sample a couple pages to decide if PDF is text-based.
        sample = read_pdf_text_sample(path, max_pages=2)
        kind = "pdf-text"
        if is_mostly_empty(sample):
            pages = ocr_pdf_pages(path)
            kind = "pdf-ocr"
        else:
            # If it seems text-based, read all pages (still cheap compared to OCR).
            pages = read_pdf_text_pages(path)

        overall, en, ru, ua, unk, likely_translation, notes = analyze_pages(pages)
        return Result(os.path.basename(path), kind, overall, en, ru, ua, unk,
                      "yes" if likely_translation else "no", notes)

    raise ValueError("unsupported")

def main(input_dir: str, out_csv: str = "lang_report.csv"):
    rows: List[Result] = []
    for root, _, files in os.walk(input_dir):
        for fn in files:
            if not fn.lower().endswith((".pdf", ".docx")):
                continue
            full = os.path.join(root, fn)
            try:
                r = scan_file(full)
                r.file = os.path.relpath(full, input_dir)
                rows.append(r)
            except Exception as e:
                rows.append(Result(os.path.relpath(full, input_dir), "error", "", 0, 0, 0, 0, "", f"ERROR:{e}"))

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file","kind","overall","en_pages","ru_pages","ua_pages","unknown_pages","likely_translation","notes"])
        for r in rows:
            w.writerow([r.file, r.kind, r.overall, r.en_pages, r.ru_pages, r.ua_pages, r.unknown_pages, r.likely_translation, r.notes])

    print(f"Wrote {len(rows)} rows -> {out_csv}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python scan_lang.py /path/to/folder [out.csv]")
        raise SystemExit(2)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "lang_report.csv")