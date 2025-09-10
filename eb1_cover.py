# eb1_cover.py — refined for affidavit format (URLs included)
from pathlib import Path
import re
from typing import List, Tuple
from docx import Document
from lxml import etree  # used via python-docx; no extra install needed

# Attachment <num> - <desc> [, available at <URL>]
# Stops before the next "Attachment <num>" or closing punctuation/end
ATTACHMENT_RE = re.compile(
    r"""Attachment\s+(\d+)\s*[-–—:]?\s*         # "Attachment <num> -"
        (.+?)                                   # description (lazy)
        (?:,\s*available\s+at\s+(https?://[^\s)\]>,;"']+))?   # optional URL
        (?=                                     # stop when the next token is...
            \s*(?:and\s+Attachment\s+\d+\s*[-–—:])|           # "... and Attachment N -"
            \s*(?:Attachment\s+\d+\s*[-–—:])|                 # or "Attachment N -"
            \s*[).;]|                                         # or a ) . ;
            \s*$                                              # or end of paragraph
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

URL_IN_DESC_RE = re.compile(r'https?://[^\s)\]>,;"\']+')

def _iter_paragraphs(docx_path: Path):
    doc = Document(str(docx_path))
    return doc.paragraphs  # return objects so we can inspect XML

def _paragraph_text(p) -> str:
    return p.text.strip()

def _hyperlinks_in_paragraph(p) -> List[str]:
    """Return all hyperlink targets present in the paragraph, in document order.
    Handles <w:hyperlink>, <w:fldSimple w:instr="HYPERLINK...">, and scattered <w:instrText>."""
    urls: List[str] = []
    et = etree.fromstring(etree.tostring(p._p))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

    # 1) <w:hyperlink r:id="...">
    for h in et.xpath('.//w:hyperlink', namespaces=ns):
        rid = h.get('{%s}id' % ns['r'])
        if rid and rid in p.part.rels:
            rel = p.part.rels[rid]
            target = getattr(rel, 'target_ref', None) or getattr(rel, 'target', None) or getattr(rel, '_target', None)
            if target:
                urls.append(str(target))

    # 2) <w:fldSimple w:instr='HYPERLINK "..."'>
    for fld in et.xpath('.//w:fldSimple', namespaces=ns):
        instr = fld.get('{%s}instr' % ns['w']) or ''
        m = re.search(r'HYPERLINK\s+"([^"]+)"', instr, flags=re.I)
        if m:
            urls.append(m.group(1))

    # 3) Scattered <w:instrText> (rare)
    for node in et.xpath('.//w:instrText', namespaces=ns):
        txt = ''.join(node.itertext()) if node is not None else ''
        m = re.search(r'HYPERLINK\s+"([^"]+)"', txt, flags=re.I)
        if m:
            urls.append(m.group(1))

    return urls

def _clean_desc(raw: str) -> str:
    desc = ' '.join((raw or '').strip().split())
    # Normalize phrasing
    desc = re.sub(r',?\s*available\s+at\s+', ', available at ', desc, flags=re.I)
    # If desc ends with a naked URL, do NOT add a trailing period
    if re.search(r'https?://[^\s)\]>\]}]+$', desc or ''):
        return desc
    desc = desc.rstrip(' .')
    if desc:
        desc += '.'
    return desc

def _dedupe_best(pairs: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
    """Prefer entries that include URLs; otherwise prefer longer description."""
    best = {}
    for num, desc in pairs:
        cand_has_url = "http" in (desc or '')
        if num not in best:
            best[num] = desc
        else:
            cur = best[num]
            cur_has_url = "http" in cur
            if (cand_has_url and not cur_has_url) or (cand_has_url == cur_has_url and len(desc) > len(cur)):
                best[num] = desc
    return sorted(best.items(), key=lambda t: t[0])

def extract_attachments(docx_path: str, debug: bool = False) -> List[Tuple[int, str]]:
    out: List[Tuple[int, str]] = []
    for p in _iter_paragraphs(Path(docx_path)):
        text = _paragraph_text(p)
        if not text or 'attachment' not in text.lower():
            continue

        para_links = _hyperlinks_in_paragraph(p)
        link_cursor = 0

        matches = list(ATTACHMENT_RE.finditer(text))
        if debug and matches:
            print(f"\n[PARA] {text}")
        for m in matches:
            num = int(m.group(1))
            desc = (m.group(2) or '').strip()
            url = (m.group(3) or '').strip()

            # Fallback 1: URL embedded in desc
            if not url:
                found = URL_IN_DESC_RE.search(desc)
                if found:
                    url = found.group(0).strip()

            # Fallback 2: “available at” present but no visible URL -> use next hyperlink in this paragraph
            if not url:
                tail = text[m.end(): m.end()+120].lower()  # small window after the match
                if 'available at' in tail and link_cursor < len(para_links):
                    url = para_links[link_cursor]
                    link_cursor += 1

            full_desc = desc
            if url and "available at" not in full_desc.lower():
                full_desc = f"{full_desc}, available at {url}"

            cleaned = _clean_desc(full_desc)
            out.append((num, cleaned))
            if debug:
                print(f"  -> ({num}) {cleaned}")

    return _dedupe_best(out)

def display_attachments(attachments: List[Tuple[int, str]]):
    for num, desc in attachments:
        print(f"({num}) {desc}")

# Back-compat
def gather(docx_path: str):
    return extract_attachments(docx_path)

def display(groups):
    if isinstance(groups, list):
        display_attachments(groups)
    else:
        for sec, items in groups.items():
            print(sec)
            for num, desc in items:
                print(f"({num}) {desc}")
            print()

if __name__ == "__main__":
    raw_input_path = input("Enter the path to the .docx file: ").strip()
    path = Path(raw_input_path.strip('\'"'))
    if not path.exists() or path.suffix.lower() != '.docx':
        print("Invalid path or not a .docx file. Exiting.")
    else:
        print("\n--- DEBUG MODE: Showing matches ---")
        attachments = extract_attachments(str(path), debug=True)
        print(f"\n--- RESULTS ---")
        if attachments:
            display_attachments(attachments)
        else:
            print("No attachments found in the document.")
            print("\nTry running again and check the debug output above to see the actual text patterns.")
