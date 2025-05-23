from collections import defaultdict
from pathlib import Path
import re
from docx import Document  # pip install python-docx

# -------- regex helpers --------------------------------------------------
SECTION_RX = re.compile(r'^[IVXLCDM]+\.\s+.+', re.I)
ATTACH_RX = re.compile(
    r'Attachment\s+(\d+)\s*[-–—]\s*'
    r'([^.;\n]+(?:[.;]\s*https?://\S+)?)',
    re.I
)

def iter_paragraph_text(docx_path: str):
    doc = Document(docx_path)
    for p in doc.paragraphs:
        txt = p.text.strip()
        if txt:
            yield txt

def gather(docx_path: str):
    by_sec = defaultdict(list)
    current_sec = "UNSPECIFIED SECTION"

    for para in iter_paragraph_text(docx_path):
        if SECTION_RX.match(para):
            current_sec = para
            continue
        for num, desc in ATTACH_RX.findall(para.replace('–', '-')):
            by_sec[current_sec].append((int(num), desc.strip()))

    for sec in by_sec:
        by_sec[sec].sort(key=lambda t: t[0])
    return by_sec

def display(groups):
    for sec, items in groups.items():
        print(sec)
        for _, desc in items:
            print(desc)
        print()  # blank line between sections

if __name__ == "__main__":
    raw_input = input("Enter the path to the .docx file: ").strip()
    clean_path_str = raw_input.strip('\'"')
    path = Path(clean_path_str)

    if not path.exists() or path.suffix.lower() != '.docx':
        print("Invalid path or not a .docx file. Exiting.")
    else:
        sections = gather(str(path))
        display(sections)
