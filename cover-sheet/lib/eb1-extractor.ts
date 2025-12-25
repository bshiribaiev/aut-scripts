// lib/eb1-extractor.ts - Port of eb1_cover.py logic
export interface Attachment {
  num: number;
  desc: string;
}

export interface GroupedAttachments {
  [section: string]: Attachment[];
}

// Also handle "(See Attachment N – ...)" format embedded in paragraphs
const SEE_ATTACHMENT_RE = /\(See\s+Attachment\s+(\d+)\s*[-–—]\s*(.+?)(?:,?\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/[^\s)]+))?\s*\)/gi;

const ITEM_ENUM_RE = /^\s*\((\d+)\)\s*(.+?)(?:,\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/\S+))?\s*\.?\s*$/i;

const URL_IN_TEXT_RE = /https?:\/\/\S+/g;

const SECTION_LINE_RE = /^\s*(?:EVIDENCE\b.*|DOCUMENTATION TO ESTABLISH\b.*|SUSTAINED NATIONAL OR INTERNATIONAL ACCLAIM\b.*)$/i;

function cleanDesc(raw: string): string {
  let desc = raw.trim().replace(/\s+/g, ' ');
  
  // Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
  desc = desc.replace(/,?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+/gi, '');
  
  // Normalize weird "is, available at" and spacing
  desc = desc.replace(/\bis,\s*available\s+at\b/gi, 'is available at');
  
  // Normalize "available at"
  desc = desc.replace(/,?\s*available\s+at\s*[:\-–—]?\s*/gi, ', available at ');
  
  // If desc already ends with a URL, don't add a period
  if (/https?:\/\/\S+$/.test(desc)) {
    return desc;
  }
  
  // Tidy punctuation artifacts
  desc = desc.replace(/\s*,\s*-\s*$/, '');
  desc = desc.replace(/[\s.,;]+$/, '');
  
  return desc ? desc + '.' : desc;
}

function dedupeBest(pairs: Attachment[]): Attachment[] {
  const best: { [num: number]: string } = {};
  
  for (const { num, desc } of pairs) {
    const candHasUrl = desc.includes('http');
    
    if (!best[num]) {
      best[num] = desc;
    } else {
      const cur = best[num];
      const curHasUrl = cur.includes('http');
      
      if ((candHasUrl && !curHasUrl) || (candHasUrl === curHasUrl && desc.length > cur.length)) {
        best[num] = desc;
      }
    }
  }
  
  return Object.entries(best)
    .map(([num, desc]) => ({ num: parseInt(num), desc }))
    .sort((a, b) => a.num - b.num);
}

export function extractEB1(text: string): GroupedAttachments {
  const groups: GroupedAttachments = {};
  let currentSection: string | null = null;
  
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Detect section headers (exclude CONCLUSION)
    if (SECTION_LINE_RE.test(trimmed) && !/CONCLUSION/i.test(trimmed)) {
      let title = trimmed.replace(/\s+/g, ' ').toUpperCase();
      // Remove "(PAGES ...)" from section titles
      title = title.replace(/\s*\(PAGES?\s+[\d\-–—,\s]+\)/gi, '');
      // Remove trailing punctuation like semicolons or periods
      title = title.replace(/[;.]+$/, '').trim();
      
      // Normalize similar section names to prevent duplicates
      if (/EVIDENCE.*LEADING.*CRITICAL.*ROLE/i.test(title)) {
        title = 'EVIDENCE OF LEADING OR CRITICAL ROLE IN AN ORGANIZATION';
      }
      if (/EVIDENCE.*MEMBERSHIP.*ASSOCIATIONS.*(?:THAT|WHICH).*DEMAND/i.test(title)) {
        title = 'EVIDENCE OF MY MEMBERSHIP IN ASSOCIATIONS IN THE FIELD WHICH DEMAND OUTSTANDING ACHIEVEMENT OF THEIR MEMBERS';
      }
      
      currentSection = title;
      if (!groups[currentSection]) {
        groups[currentSection] = [];
      }
      continue;
    }
    
    // Only process items if we're inside a section (skip items 1-19 before first section)
    if (!currentSection) continue;
    
    let matchedAny = false;
    
    // First, check for "(See Attachment N – ...)" format
    const seeAttachmentMatches = Array.from(trimmed.matchAll(SEE_ATTACHMENT_RE));
    if (seeAttachmentMatches.length > 0) {
      const pairs: Attachment[] = [];
      
      for (const m of seeAttachmentMatches) {
        const num = parseInt(m[1]);
        let desc = (m[2] || '').trim().replace(/,$/, '');
        let url = (m[3] || '').trim();
        
        // Look for URL in the rest of the paragraph if not captured
        if (!url) {
          const restOfPara = trimmed.slice((m.index || 0) + m[0].length);
          const urlMatch = restOfPara.match(/available\s+at\s+[:\-–—]?\s*(https?:\/\/\S+)/i);
          if (urlMatch) {
            url = urlMatch[1];
          }
        }
        
        // Build final description
        let fullDesc = desc;
        if (url) {
          if (!/available\s+at/i.test(fullDesc)) {
            fullDesc = `${fullDesc}, available at ${url}`;
          } else {
            fullDesc = fullDesc.replace(/(available\s+at)\s*[:\-–—]?\s*$/i, `$1 ${url}`);
          }
        }
        
        pairs.push({ num, desc: cleanDesc(fullDesc) });
      }
      
      if (pairs.length > 0) {
        matchedAny = true;
        groups[currentSection].push(...pairs);
      }
    }
    
    // Fallback: handle plain enumerations like "(12) Description, available at: URL"
    if (!matchedAny) {
      const m = trimmed.match(ITEM_ENUM_RE);
      if (m) {
        const num = parseInt(m[1]);
        let desc = (m[2] || '').trim().replace(/,$/, '');
        let url = (m[3] || '').trim();
        
        // Look for URL anywhere in the line
        if (!url) {
          const found = trimmed.match(/available\s+at\s+[:\-–—]?\s*(https?:\/\/\S+)/i);
          if (found) {
            url = found[1];
          }
        }
        
        let fullDesc = desc;
        if (url) {
          if (!/available\s+at/i.test(fullDesc)) {
            fullDesc = `${fullDesc}, available at ${url}`;
          } else {
            fullDesc = fullDesc.replace(/(available\s+at)\s*[:\-–—]?\s*$/i, `$1 ${url}`);
          }
        }
        
        groups[currentSection].push({ num, desc: cleanDesc(fullDesc) });
      }
    }
  }
  
  // Final pass: dedupe per section and remove empty sections
  const result: GroupedAttachments = {};
  for (const sect in groups) {
    const deduped = dedupeBest(groups[sect]);
    if (deduped.length > 0) {
      result[sect] = deduped;
    }
  }
  
  return result;
}
