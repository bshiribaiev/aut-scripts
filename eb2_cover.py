# eb2_cover.py (fixed)
from collections import defaultdict
from pathlib import Path
import re
from docx import Document  # pip install python-docx

# -------- regex helpers --------------------------------------------------
SECTION_RX = re.compile(r'^[IVXLCDM]+\.\s+.+', re.I)

# Anchor used to locate each attachment and then slice until the next one
ATTACH_ANCHOR_RX = re.compile(r'Attachment\s+(\d+)\s*[-–—]\s*', re.I)

# grab full URL up to whitespace or ')'
URL_RX = re.compile(r'https?://[^\s)]+')


def iter_paragraph_text(docx_path: str):
    doc = Document(docx_path)
    for p in doc.paragraphs:
        txt = p.text.strip()
        if txt:
            yield txt


def _clean_desc(raw: str) -> str:
    desc = raw.strip()

    # Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
    desc = re.sub(r',?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+', '', desc, flags=re.I)

    # If a URL is followed immediately by a closing paren, keep the URL clean but drop the dangling ')'
    # Example: "... https://example.com/path)."
    # We'll just leave the ')' to punctuation cleanup below.
    # Normalize ugly tail punctuation like ")." -> "."
    desc = re.sub(r'\)\.$', '.', desc)   # ")." -> "."
    desc = re.sub(r'\)$', '', desc)      # lone ')' at end -> drop

    # Ensure single terminal period (don’t double up)
    desc = desc.rstrip()
    if not desc.endswith('.'):
        desc += '.'
    return desc


def gather(docx_path: str):
    by_sec = defaultdict(list)
    # Track which attachment numbers we've seen per section
    seen_in_sec = defaultdict(set)
    current_sec = "UNSPECIFIED SECTION"

    for para in iter_paragraph_text(docx_path):
        if SECTION_RX.match(para):
            current_sec = para
            continue

        # Find all "Attachment N —" anchors in this paragraph and slice between them
        matches = list(ATTACH_ANCHOR_RX.finditer(para))
        if not matches:
            continue

        for i, m in enumerate(matches):
            num = int(m.group(1))

            # Skip if we've already seen this attachment number in this section
            if num in seen_in_sec[current_sec]:
                continue

            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(para)
            raw_desc = para[start:end]

            # Trim trailing junk that often follows the reference on the same line
            # but DO NOT clip URLs: we rely on anchor slicing so URLs stay intact
            desc = _clean_desc(raw_desc)

            by_sec[current_sec].append((num, desc))
            seen_in_sec[current_sec].add(num)  # Mark this attachment as seen

    # Sort by attachment number within each section
    for sec in by_sec:
        by_sec[sec].sort(key=lambda t: t[0])

    return by_sec


def display(groups):
    for sec, items in groups.items():
        print(sec)
        for num, desc in items:
            # desc is already cleaned and properly punctuated
            print(f"({num}) {desc}")
        print()  # blank line between sections


if __name__ == "__main__":
    raw_input_path = input("Enter the path to the .docx file: ").strip()
    clean_path_str = raw_input_path.strip('\'"')
    path = Path(clean_path_str)

    if not path.exists() or path.suffix.lower() != '.docx':
        print("Invalid path or not a .docx file. Exiting.")
    else:
        sections = gather(str(path))
        display(sections)
