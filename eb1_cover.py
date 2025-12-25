
# eb1_cover_v3.py — robust section-aware attachment extractor (broader section headers incl. High Salary)
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
        (?:,\s*available\s+at\s*[:\-–—]?\s*(https?://[^\s)\]>,;"']+))?   # optional URL (after 'available at')
        (?=                                     # stop before:
            \s*(?:and\s+Attachment\s+\d+\s*[-–—:])|  # "... and Attachment N -"
            \s*(?:Attachment\s+\d+\s*[-–—:])|        # or "Attachment N -"
            \s*[).;]|                                # or a ) . ;
            \s*$                                     # or end of paragraph
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Also handle "(See Attachment N – ...)" format embedded in paragraphs
SEE_ATTACHMENT_RE = re.compile(
    r"""\(See\s+Attachment\s+(\d+)\s*[-–—]\s*  # "(See Attachment <num> –"
        (.+?)                                   # description (lazy)
        (?:,?\s*available\s+at\s*[:\-–—]?\s*(https?://[^\s)]+))?  # optional URL
        \s*\)                                   # closing paren
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Also capture plain enumerations like "(123) Description..., available at: URL"
ITEM_ENUM_RE = re.compile(
    r"""
    ^\s*\((\d+)\)\s*                # leading (num)
    (.+?)                           # description
    (?:,\s*available\s+at\s*[:\-–—]?\s*(https?://[^\s)\]>,;"']+))?
    \s*\.?\s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

URL_IN_TEXT_RE = re.compile(r'https?://[^\s)\]>,;"\']+')

# === Section header detection ===
SECTION_LINE_RE = re.compile(
    r'^\s*(?:EVIDENCE\b.*|DOCUMENTATION TO ESTABLISH\b.*|SUSTAINED NATIONAL OR INTERNATIONAL ACCLAIM\b.*)$',
    re.IGNORECASE
)

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

    # De-duplicate while preserving order
    seen = set()
    out = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out

def _looks_truncated(url: str) -> bool:
    if not url:
        return True
    if url.endswith(('https://www', 'http://www', 'www')):
        return True
    m = re.match(r'https?://([^/]+)', url)
    if not m:
        return True
    host = m.group(1)
    return '.' not in host

def _clean_desc(raw: str) -> str:
    desc = ' '.join((raw or '').strip().split())
    # Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
    desc = re.sub(r',?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+', '', desc, flags=re.I)
    # Normalize weird "is, available at" and spacing
    desc = re.sub(r'\bis,\s*available\s+at\b', 'is available at', desc, flags=re.I)
    # Normalize "available at"
    desc = re.sub(r',?\s*available\s+at\s*[:\-–—]?\s*', ', available at ', desc, flags=re.I)
    # If desc already ends with a URL, don't add a period
    if re.search(r'https?://[^\s)\]>\]}]+$', desc or ''):
        return desc
    # Tidy punctuation artifacts
    desc = re.sub(r'\s*,\s*-\s*$', '', desc)
    desc = desc.rstrip(' .,;')
    return (desc + '.') if desc else desc

def _dedupe_best(pairs: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
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
    groups: "OrderedDict[Optional[str], List[Tuple[int, str]]]" = OrderedDict()
    current_section: Optional[str] = None
    groups.setdefault(current_section, [])

    for p in _iter_paragraphs(Path(docx_path)):
        text = _paragraph_text(p)
        if not text:
            continue

        # Detect section headers (exclude CONCLUSION)
        if SECTION_LINE_RE.match(text) and 'CONCLUSION' not in text.upper():
            title = ' '.join(text.split())
            # Remove "(PAGES ...)" from section titles
            title = re.sub(r'\s*\(PAGES?\s+[\d\-–—,\s]+\)', '', title, flags=re.I)
            # Remove trailing punctuation like semicolons or periods
            title = title.rstrip(';.').strip()
            current_section = title.upper()
            if current_section not in groups:
                groups[current_section] = []
            if debug:
                print(f"[SECTION] {current_section}")
            continue

        matched_any = False

        # First, check for "(See Attachment N – ...)" format
        if 'see attachment' in text.lower():
            para_links = _hyperlinks_in_paragraph(p)
            link_cursor = 0
            pairs = []
            see_matches = list(SEE_ATTACHMENT_RE.finditer(text))

            for m in see_matches:
                num = int(m.group(1))
                desc = (m.group(2) or '').strip().rstrip(',')
                url = (m.group(3) or '').strip()

                # Look for URL in the description if not found
                if not url:
                    found = URL_IN_TEXT_RE.search(desc)
                    if found:
                        url = found.group(0).strip()

                # Try hyperlink relationships if still missing
                if (not url or _looks_truncated(url)) and 'available at' in desc.lower() and link_cursor < len(para_links):
                    url = para_links[link_cursor]
                    link_cursor += 1

                # Build final description
                full_desc = desc
                if url:
                    if "available at" not in full_desc.lower():
                        full_desc = f"{full_desc}, available at {url}"
                    else:
                        full_desc = re.sub(r'(available\s+at)\s*[:\-–—]?\s*(?=$|[).;])',
                                           rf'\1 {url}', full_desc, flags=re.I)
                        full_desc = re.sub(r'(available\s+at\s*[:\-–—]?\s*)(https?://[^\s)\]>,;"\']*)',
                                           rf'\1{url}', full_desc, flags=re.I)

                pairs.append((num, _clean_desc(full_desc)))

            if pairs and current_section:
                matched_any = True
                groups[current_section].extend(pairs)

        # Extract "Attachment N - ..." items inside the paragraph
        if not matched_any and 'attachment' in text.lower():
            para_links = _hyperlinks_in_paragraph(p)
            link_cursor = 0
            pairs = []
            all_matches = list(ATTACHMENT_RE.finditer(text))

            for i, m in enumerate(all_matches):
                num = int(m.group(1))
                desc = (m.group(2) or '').strip().rstrip(',')
                url = (m.group(3) or '').strip()

                # Prefer a URL found in the visible text (in or near the match span)
                if not url:
                    found = URL_IN_TEXT_RE.search(text[m.start(): m.end()])
                    if found:
                        url = found.group(0).strip()
                if not url:
                    found = URL_IN_TEXT_RE.search(desc)
                    if found:
                        url = found.group(0).strip()

                # If missing or looks truncated, try hyperlink relationships in match window or after
                if (not url or _looks_truncated(url)) and 'available at' in text[m.start(): m.end()].lower() and link_cursor < len(para_links):
                    url = para_links[link_cursor]
                    link_cursor += 1

                if (not url or _looks_truncated(url)):
                    next_start = all_matches[i+1].start() if i + 1 < len(all_matches) else len(text)
                    window = text[m.end(): next_start]
                    if 'available at' in window.lower() and link_cursor < len(para_links):
                        url = para_links[link_cursor]
                        link_cursor += 1

                # Build final description, inserting or replacing URL
                full_desc = desc
                if url:
                    if "available at" not in full_desc.lower():
                        full_desc = f"{full_desc}, available at {url}"
                    else:
                        full_desc = re.sub(r'(available\s+at)\s*[:\-–—]?\s*(?=$|[).;])',
                                           rf'\1 {url}', full_desc, flags=re.I)
                        full_desc = re.sub(r'(available\s+at\s*[:\-–—]?\s*)(https?://[^\s)\]>,;"\']*)',
                                           rf'\1{url}', full_desc, flags=re.I)

                pairs.append((num, _clean_desc(full_desc)))

            if pairs:
                matched_any = True
                groups[current_section].extend(_dedupe_best(pairs))

        # Fallback: handle plain enumerations like "(12) Description, available at: URL"
        if not matched_any and current_section:
            m = ITEM_ENUM_RE.match(text)
            if m:
                para_links = _hyperlinks_in_paragraph(p)
                num = int(m.group(1))
                desc = (m.group(2) or '').strip().rstrip(',')
                url = (m.group(3) or '').strip()

                # Prefer any URL in the paragraph text
                if not url:
                    found = URL_IN_TEXT_RE.search(text)
                    if found:
                        url = found.group(0).strip()

                # If still missing or looks truncated, but a hyperlink exists, use it
                if (not url or _looks_truncated(url)) and para_links:
                    url = para_links[0]

                full_desc = desc
                if url:
                    if "available at" not in full_desc.lower():
                        full_desc = f"{full_desc}, available at {url}"
                    else:
                        full_desc = re.sub(r'(available\s+at)\s*[:\-–—]?\s*(?=$|[).;])',
                                           rf'\1 {url}', full_desc, flags=re.I)
                        full_desc = re.sub(r'(available\s+at\s*[:\-–—]?\s*)(https?://[^\s)\]>,;"\']*)',
                                           rf'\1{url}', full_desc, flags=re.I)

                groups[current_section].append((num, _clean_desc(full_desc)))

    # Final pass: dedupe per section and remove empty sections
    result = OrderedDict()
    for sect in list(groups.keys()):
        deduped = _dedupe_best(groups[sect])
        if deduped:  # Only include sections with attachments
            result[sect] = deduped

    return result

def display_grouped(groups: Dict[Optional[str], List[Tuple[int, str]]]) -> None:
    for sect, items in groups.items():
        if sect is None or not items:
            for num, desc in items:
                print(f"({num}) {desc}")
        else:
            print(sect)
            for num, desc in items:
                print(f"({num}) {desc}")
            print()

# Back-compat helpers

def iter_paragraph_text(docx_path: str):
    for p in _iter_paragraphs(Path(docx_path)):
        txt = p.text.strip()
        if txt:
            yield txt

def extract_attachments(docx_path: str, debug: bool=False):
    groups = extract_grouped(docx_path, debug=debug)
    flat = []
    for items in groups.values():
        flat.extend(items)
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
