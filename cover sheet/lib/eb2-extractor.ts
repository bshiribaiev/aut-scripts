// lib/eb2-extractor.ts - Port of eb2_cover.py logic
export interface Attachment {
  num: number;
  desc: string;
}

export interface GroupedAttachments {
  [section: string]: Attachment[];
}

const SECTION_RX = /^[IVXLCDM]+\.\s+.+/i;
// Anchor used to locate each attachment and then slice until the next one
const ATTACH_ANCHOR_RX = /Attachment\s+(\d+)\s*[-–—]\s*/gi;

// Convert Roman numeral to number for sorting
function romanToNumber(roman: string): number {
  const romanMap: { [key: string]: number } = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
  };
  
  let result = 0;
  let prevValue = 0;
  
  for (let i = roman.length - 1; i >= 0; i--) {
    const value = romanMap[roman[i]] || 0;
    if (value < prevValue) {
      result -= value;
    } else {
      result += value;
    }
    prevValue = value;
  }
  
  return result;
}

// Extract Roman numeral from section header
function extractRomanNumeral(section: string): number | null {
  const match = section.match(/^([IVXLCDM]+)\./i);
  if (match) {
    return romanToNumber(match[1].toUpperCase());
  }
  return null;
}

function cleanDesc(raw: string): string {
  let desc = raw.trim();
  
  // Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
  desc = desc.replace(/,?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+/gi, '');
  
  // Normalize ugly tail punctuation like ")." -> "."
  desc = desc.replace(/\)\.$/, '.');
  desc = desc.replace(/\)$/, '');
  
  // Ensure single terminal period (don't double up)
  desc = desc.trim();
  if (!desc.endsWith('.')) {
    desc += '.';
  }
  
  return desc;
}

export function extractEB2(text: string): GroupedAttachments {
  const bySec: GroupedAttachments = {};
  const seenInSec: { [section: string]: Set<number> } = {};
  let currentSec = ""; // Empty string for attachments before any section
  
  // Initialize default section (attachments before any section header)
  if (!bySec[currentSec]) {
    bySec[currentSec] = [];
    seenInSec[currentSec] = new Set();
  }
  
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Check if it's a section header (exclude CONCLUSION)
    if (SECTION_RX.test(trimmed) && !/CONCLUSION/i.test(trimmed)) {
      currentSec = trimmed.replace(/\s+/g, ' ').trim();
      if (!bySec[currentSec]) {
        bySec[currentSec] = [];
        seenInSec[currentSec] = new Set();
      }
      continue;
    }
    
    // Find all "Attachment N —" anchors in this paragraph and slice between them
    const matches = Array.from(trimmed.matchAll(ATTACH_ANCHOR_RX));
    if (matches.length === 0) {
      continue;
    }
    
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const num = parseInt(m[1]);
      
      // Skip if we've already seen this attachment number in this section
      if (seenInSec[currentSec].has(num)) {
        continue;
      }
      
      // Extract text from after this anchor to the start of the next anchor (or end of paragraph)
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
      const rawDesc = trimmed.substring(start, end);
      
      // Clean the description
      const desc = cleanDesc(rawDesc);
      
      if (desc) {
        bySec[currentSec].push({ num, desc });
        seenInSec[currentSec].add(num);
      }
    }
  }
  
  // Sort by attachment number within each section and remove empty sections
  const sections: Array<{ name: string; attachments: Attachment[] }> = [];
  for (const sec in bySec) {
    const sorted = bySec[sec].sort((a, b) => a.num - b.num);
    if (sorted.length > 0) {
      sections.push({ name: sec, attachments: sorted });
    }
  }
  
  // Sort sections by Roman numeral order
  sections.sort((a, b) => {
    // Handle empty section name (attachments before any section) - put it at the beginning
    if (a.name === "") return -1;
    if (b.name === "") return 1;
    
    const numA = extractRomanNumeral(a.name);
    const numB = extractRomanNumeral(b.name);
    
    // If both have Roman numerals, sort by number
    if (numA !== null && numB !== null) {
      return numA - numB;
    }
    
    // If only one has a Roman numeral, put it first
    if (numA !== null) return -1;
    if (numB !== null) return 1;
    
    // Otherwise, sort alphabetically
    return a.name.localeCompare(b.name);
  });
  
  // Convert back to object (maintaining order)
  const result: GroupedAttachments = {};
  for (const { name, attachments } of sections) {
    result[name] = attachments;
  }
  
  return result;
}
