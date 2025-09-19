from pathlib import Path
import re
from docx import Document
from docx.oxml.ns import qn  # for hyperlink extraction

ANCHOR_RX = re.compile(r'(?i)\bAttachment\s+(\d+)\s*[-–—]\s*')

def paragraph_text_with_urls(p):
    base = p.text or ""
    urls = []
    for h in p._element.iter():
        if h.tag == qn('w:hyperlink'):
            rid = h.get(qn('r:id'))
            if rid and rid in p.part.rels:
                target = p.part.rels[rid].target_ref
                if target and target not in urls:
                    urls.append(target)
    # If no visible URL in text, append hyperlink targets so "available at" gets the URL
    if not re.search(r'https?://\S+', base, flags=re.I) and urls:
        base = (base.rstrip() + " " + " ".join(urls)).strip()
    return base.strip()

def load_paragraphs_with_urls(docx_path: Path):
    doc = Document(str(docx_path))
    return [paragraph_text_with_urls(p) for p in doc.paragraphs]

def tidy(s: str) -> str:
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s*-\s*\.\s*', ' - ', s)  # fix " - . " -> " - "
    s = re.sub(r'\)\.\s*$', '.', s)        # change ")." -> "."
    return s

def looks_like_url_end(s: str) -> bool:
    return bool(re.search(r'https?://\S+$', s, re.I))

def finalize(desc: str) -> str:
    # strip leading junk like starting hyphens/colons
    desc = re.sub(r'^[\s\-\–\—:]+', '', desc)
    if looks_like_url_end(desc):
        # don't add period if it ends with a URL
        desc = re.sub(r'[\s\-\–\—:;,\.]+$', '', desc)
    else:
        desc = re.sub(r'[\s\-\–\—:;,]+$', '', desc)
        desc = re.sub(r'\)+$', '', desc)  # drop trailing unmatched ')'
        if not desc.endswith('.'):
            desc += '.'
    return desc

def extract_attachments(docx_path: Path):
    paras = load_paragraphs_with_urls(docx_path)
    results = []
    seen = set()
    for pi, para in enumerate(paras):
        if not para:
            continue
        matches = list(ANCHOR_RX.finditer(para))
        if not matches:
            continue
        for mi, m in enumerate(matches):
            num = int(m.group(1))
            start = m.end()
            end = matches[mi+1].start() if mi+1 < len(matches) else len(para)
            slice_txt = para[start:end]

            # Look ahead for URL-only continuation on the next line(s)
            extra = ''
            if not re.search(r'https?://\S+', slice_txt, re.I):
                pj = pi + 1
                appended = 0
                while pj < len(paras) and appended < 2:
                    nxt = paras[pj].strip()
                    if not nxt or ANCHOR_RX.search(nxt):
                        break
                    if re.search(r'https?://\S+', nxt, re.I):
                        extra += ' ' + nxt
                        appended += 1
                        pj += 1
                        continue
                    if re.search(r'(?i)(available\s+at\s*-?)\s*$', slice_txt) and appended == 0:
                        extra += ' ' + nxt
                        appended += 1
                        pj += 1
                        continue
                    break

            desc = tidy(slice_txt + extra)
            desc = finalize(desc)

            if num not in seen:
                seen.add(num)
                results.append((num, desc))
    return sorted(results, key=lambda t: t[0])

if __name__ == "__main__":
    # Interactive prompt; handles spaces and optional user-provided quotes
    path_input = input("Enter path to the .docx file: ").strip()
    path_input = path_input.strip('"').strip("'")
    path = Path(path_input)
    if not path.exists() or path.suffix.lower() != ".docx":
        print(f'Invalid path or not a .docx file: "{path_input}"')
    else:
        for num, desc in extract_attachments(path):
            print(f"({num}) {desc}")
