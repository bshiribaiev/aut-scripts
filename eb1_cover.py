# eb1_cover.py — section-aware attachment extractor
from collections import OrderedDict
from pathlib import Path
import re
from typing import List, Tuple, Dict, Optional
from docx import Document  # pip install python-docx
from lxml import etree     # pip install lxml

# === Patterns ===

ATTACHMENT_RE = re.compile(
    r"""Attachment\s+(\d+)\s*[-–—:]?\s*         # "Attachment <num> -"
        (.+?)                                   # description (lazy)
        (?:,\s*available\s+at\s+(https?://[^\s)\]>,;"']+))?   # optional URL
        (?=                                     # stop before:
            \s*(?:and\s+Attachment\s+\d+\s*[-–—:])|  # "... and Attachment N -"
            \s*(?:Attachment\s+\d+\s*[-–—:])|        # or "Attachment N -"
            \s*[).;]|                                # or a ) . ;
            \s*$                                     # or end of paragraph
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

URL_IN_DESC_RE = re.compile(r'https?://[^\s)\]>,;"\']+')

# Section starts to catch the affidavit’s big headings
SECTION_PREFIXES = (
    "EVIDENCE OF",
    "DOCUMENTATION TO ESTABLISH",
    "SUSTAINED NATIONAL OR INTERNATIONAL ACCLAIM",
    "CONCLUSION",
)
SECTION_RE = re.compile(r'^\s*(?:' + '|'.join(re.escape(p) for p in SECTION_PREFIXES) + r')\b.*$', re.I)

# === Low-level helpers ===

def _iter_paragraphs(docx_path: Path):
    doc = Document(str(docx_path))
    return doc.paragraphs

def _paragraph_text(p) -> str:
    return p.text.strip()

def _hyperlinks_in_paragraph(p) -> List[str]:
    """Return all hyperlink targets (even when URL text is hidden) for a paragraph."""
    urls: List[str] = []
    et = etree.fromstring(etree.tostring(p._p))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

    # <w:hyperlink r:id="rIdX"> with rel target
    for h in et.xpath('.//w:hyperlink', namespaces=ns):
        rid = h.get('{%s}id' % ns['r'])
        if rid and rid in p.part.rels:
            rel = p.part.rels[rid]
            target = getattr(rel, 'target_ref', None) or getattr(rel, 'target', None) or getattr(rel, '_target', None)
            if target:
                urls.append(str(target))

    # Field-code style hyperlinks
    for fld in et.xpath('.//w:fldSimple', namespaces=ns):
        instr = fld.get('{%s}instr' % ns['w']) or ''
        m = re.search(r'HYPERLINK\s+"([^"]+)"', instr, flags=re.I)
        if m:
            urls.append(m.group(1))
    for node in et.xpath('.//w:instrText', namespaces=ns):
        txt = ''.join(node.itertext()) if node is not None else ''
        m = re.search(r'HYPERLINK\s+"([^"]+)"', txt, flags=re.I)
        if m:
            urls.append(m.group(1))

    return urls

def _clean_desc(raw: str) -> str:
    desc = ' '.join((raw or '').strip().split())
    # Normalize “available at”
    desc = re.sub(r',?\s*available\s+at\s+', ', available at ', desc, flags=re.I)
    # If desc already ends with a URL, don't add a period
    if re.search(r'https?://[^\s)\]>\]}]+$', desc or ''):
        return desc
    # Tidy punctuation artifacts like ", -"
    desc = re.sub(r'\s*,\s*-\s*$', '', desc)
    desc = desc.rstrip(' .,;')
    return (desc + '.') if desc else desc

def _dedupe_best(pairs: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
    """Within a section, keep one line per attachment number; prefer entries with URLs or longer text."""
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

# === Public API ===

def extract_grouped(docx_path: str, debug: bool=False) -> Dict[Optional[str], List[Tuple[int, str]]]:
    """
    Returns an OrderedDict mapping:
      section_title (UPPERCASE) -> [(attachment_number, description_with_optional_url), ...]
    Attachments before the first section are stored under key None.
    """
    groups: "OrderedDict[Optional[str], List[Tuple[int, str]]]" = OrderedDict()
    current_section: Optional[str] = None
    groups.setdefault(current_section, [])

    for p in _iter_paragraphs(Path(docx_path)):
        text = _paragraph_text(p)
        if not text:
            continue

        # Detect section headers and switch the current bucket
        if SECTION_RE.match(text):
            title = ' '.join(text.split())
            current_section = title.upper()
            if current_section not in groups:
                groups[current_section] = []
            if debug:
                print(f"[SECTION] {current_section}")
            continue

        # Extract attachments inside the paragraph
        if 'attachment' in text.lower():
            para_links = _hyperlinks_in_paragraph(p)
            link_cursor = 0
            pairs = []
            all_matches = list(ATTACHMENT_RE.finditer(text))

            for i, m in enumerate(all_matches):
                num = int(m.group(1))
                desc = (m.group(2) or '').strip().rstrip(',')
                url = (m.group(3) or '').strip()

                # URL in visible text
                if not url:
                    found = URL_IN_DESC_RE.search(desc)
                    if found:
                        url = found.group(0).strip()

                # If “available at” is already in the captured desc but no visible URL,
                # use the next paragraph hyperlink
                if not url and 'available at' in desc.lower() and link_cursor < len(para_links):
                    url = para_links[link_cursor]
                    link_cursor += 1

                # Else, only look AFTER this match but BEFORE the next "Attachment N"
                if not url:
                    next_start = all_matches[i+1].start() if i + 1 < len(all_matches) else len(text)
                    window = text[m.end(): next_start].lower()
                    if 'available at' in window and link_cursor < len(para_links):
                        url = para_links[link_cursor]
                        link_cursor += 1

                # Build final description, inserting URL once if needed
                full_desc = desc
                if url and "available at" not in full_desc.lower():
                    full_desc = f"{full_desc}, available at {url}"
                elif url and "available at" in full_desc.lower():
                    # Fill in a trailing “available at” with the URL
                    full_desc = re.sub(r'(available\s+at)\s*$', rf'\1 {url}', full_desc, flags=re.I)

                pairs.append((num, _clean_desc(full_desc)))

            if pairs:
                groups[current_section].extend(_dedupe_best(pairs))

    # Final pass: dedupe per section
    for sect in list(groups.keys()):
        groups[sect] = _dedupe_best(groups[sect])

    return groups

def display_grouped(groups: Dict[Optional[str], List[Tuple[int, str]]]) -> None:
    """Print in the requested format."""
    for sect, items in groups.items():
        if sect is None or not items:
            for num, desc in items:
                print(f"({num}) {desc}")
        else:
            print(sect)
            for num, desc in items:
                print(f"({num}) {desc}")
            print()

# --- CLI-compatible helpers (back-compat) ---

def iter_paragraph_text(docx_path: str):
    for p in _iter_paragraphs(Path(docx_path)):
        txt = p.text.strip()
        if txt:
            yield txt

def extract_attachments(docx_path: str, debug: bool=False):
    """Legacy: return a flat, de-duplicated list (num, desc) across the whole doc."""
    groups = extract_grouped(docx_path, debug=debug)
    flat = []
    for items in groups.values():
        flat.extend(items)
    # unique by number
    seen = set()
    uniq = []
    for n, d in sorted(flat, key=lambda t: t[0]):
        if n not in seen:
            uniq.append((n, d))
            seen.add(n)
    return uniq

def display_attachments(attachments):
    for num, desc in attachments:
        print(f"({num}) {desc}")

def gather(docx_path: str):
    return extract_grouped(docx_path)

def display(groups):
    if isinstance(groups, dict):
        display_grouped(groups)
    else:
        display_attachments(groups)

if __name__ == "__main__":
    raw_input_path = input("Enter the path to the .docx file: ").strip()
    clean_path_str = raw_input_path.strip('\'"')
    path = Path(clean_path_str)
    if not path.exists() or path.suffix.lower() != '.docx':
        print("Invalid path or not a .docx file. Exiting.")
    else:
        groups = extract_grouped(str(path), debug=False)
        display_grouped(groups)
