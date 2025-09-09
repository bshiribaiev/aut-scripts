
from collections import defaultdict
from pathlib import Path
import re
from docx import Document  # pip install python-docx

# Multiple regex patterns to try for different formatting
ATTACHMENT_PATTERNS = [
    re.compile(r'\*\*Attachment\s+(\d+)\s*\*\*\s*[-–—]\s*([^,)]*)', re.I),  # **Attachment 1** - desc
    re.compile(r'Attachment\s+(\d+)\s*[-–—]\s*([^,)]*)', re.I),              # Attachment 1 - desc
    re.compile(r'attachment\s+(\d+)\s*[-–—]\s*([^,)]*)', re.I),              # attachment 1 - desc (lowercase)
    re.compile(r'\bAttachment\s+(\d+)\b[^)]*?\)\s*[-–—]?\s*([^,.]*)', re.I), # More flexible pattern
]

def iter_paragraph_text(docx_path: str):
    """Generator that yields text from each paragraph in the document."""
    doc = Document(docx_path)
    for p in doc.paragraphs:
        txt = p.text.strip()
        if txt:
            yield txt

def _clean_desc(raw: str) -> str:
    """Clean up the attachment description."""
    desc = raw.strip()
    
    # Remove trailing punctuation and normalize
    desc = re.sub(r'[,\s]+$', '', desc)  # Remove trailing commas and spaces
    desc = desc.rstrip('.')  # Remove trailing periods
    
    # Ensure single terminal period
    if desc and not desc.endswith('.'):
        desc += '.'
    
    return desc

def extract_attachments(docx_path: str, debug=False):
    """Extract all attachment references from the document."""
    attachments = []
    
    for para_num, para in enumerate(iter_paragraph_text(docx_path), 1):
        if debug:
            # Show paragraphs that might contain attachments
            if 'attachment' in para.lower() or 'see' in para.lower():
                print(f"Paragraph {para_num}: {repr(para)}")
        
        # Try each pattern
        for pattern_num, pattern in enumerate(ATTACHMENT_PATTERNS):
            matches = pattern.findall(para)
            if matches:
                if debug:
                    print(f"  -> Pattern {pattern_num + 1} matched: {matches}")
                
                for match in matches:
                    num = int(match[0])  # Attachment number
                    desc = _clean_desc(match[1])  # Description
                    attachments.append((num, desc))
    
    # Sort by attachment number
    attachments.sort(key=lambda t: t[0])
    
    # Remove duplicates while preserving order
    seen = set()
    unique_attachments = []
    for num, desc in attachments:
        if num not in seen:
            unique_attachments.append((num, desc))
            seen.add(num)
    
    return unique_attachments

def display_attachments(attachments):
    """Display attachments in the requested format."""
    for num, desc in attachments:
        print(f"({num}) {desc}")

# Keep the old functions for backward compatibility
def gather(docx_path: str):
    """Legacy function - redirects to new extraction method."""
    return extract_attachments(docx_path)

def display(groups):
    """Legacy function - for backward compatibility."""
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
    clean_path_str = raw_input_path.strip('\'"')
    path = Path(clean_path_str)
    
    if not path.exists() or path.suffix.lower() != '.docx':
        print("Invalid path or not a .docx file. Exiting.")
    else:
        print("\n--- DEBUG MODE: Showing relevant paragraphs ---")
        attachments = extract_attachments(str(path), debug=True)
        
        print(f"\n--- RESULTS ---")
        if attachments:
            display_attachments(attachments)
        else:
            print("No attachments found in the document.")
            print("\nTry running again and check the debug output above to see the actual text patterns.")