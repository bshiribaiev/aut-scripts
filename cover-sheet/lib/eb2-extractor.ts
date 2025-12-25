// lib/eb2-extractor.ts - Port of eb2_cover.py logic
export interface Attachment {
  num: number;
  desc: string;
}

export interface GroupedAttachments {
  [section: string]: Attachment[];
}

const SECTION_RX = /^[IVXLCDM]+\.\s+.+/i;
// Also handle "(See Attachment N – ...)" format embedded in paragraphs
const SEE_ATTACHMENT_RE = /\(See\s+Attachment\s+(\d+)\s*[-–—]\s*(.+?)(?:,?\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/\S+))?\s*\)/gi;
// Handle embedded "Attachment N -" within item descriptions
// Match: ", Attachment N - Description" where Description can contain URLs, commas, etc.
// We'll match until we see another "Attachment" pattern or end of string
const EMBEDDED_ATTACHMENT_RE = /,\s*Attachment\s+(\d+)\s*[-–—]\s*((?:(?!,\s*Attachment\s+\d+).)+?)(?=,\s*Attachment\s+\d+|$)/gi;
const ITEM_ENUM_RE = /^\s*\((\d+)\)\s*(.+?)(?:,?\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/\S+))?\s*\.?\s*$/i;
const URL_IN_TEXT_RE = /https?:\/\/\S+/g;

function cleanDesc(raw: string): string {
  let desc = raw.trim();
  
  // Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
  desc = desc.replace(/,?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+/gi, '');
  
  // Normalize ugly tail punctuation like ")." -> "."
  desc = desc.replace(/\)\.$/, '.');
  desc = desc.replace(/\)$/, '');
  
  // Remove trailing commas
  desc = desc.replace(/,\s*$/, '');
  
  // Ensure single terminal period
  desc = desc.trim();
  if (!desc.endsWith('.')) {
    desc += '.';
  }
  
  return desc;
}

export function extractEB2(text: string): GroupedAttachments {
  const bySec: GroupedAttachments = {};
  const seenInSec: { [section: string]: Set<number> } = {};
  const seenGlobally: { [num: number]: string } = {}; // Track which section each item first appeared in
  const preSectionItems: { [num: number]: Attachment } = {}; // Items before first section
  let currentSec: string | null = null;
  let firstSection: string | null = null;
  
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Check if it's a section header (exclude CONCLUSION and table of contents entries)
    if (SECTION_RX.test(trimmed) && !/CONCLUSION/i.test(trimmed)) {
      // Skip if it looks like a TOC entry (ends with just a number or tab+number)
      if (/[\t\s]+\d+\s*$/.test(trimmed)) {
        continue;
      }
      
      const newSec = trimmed.replace(/\s+/g, ' ').trim();
      // Remove trailing page numbers
      const cleanSec = newSec.replace(/\s+\d+\s*$/, '').trim();
      
      // If this is the first section, mark it
      if (firstSection === null) {
        firstSection = cleanSec;
      }
      
      currentSec = cleanSec;
      if (!bySec[currentSec]) {
        bySec[currentSec] = [];
        seenInSec[currentSec] = new Set();
      }
      continue;
    }
    
    let matchedAny = false;
    let foundItems: Attachment[] = [];
    
    // First, check for "(See Attachment N – ...)" format
    const seeAttachmentMatches = Array.from(trimmed.matchAll(SEE_ATTACHMENT_RE));
    if (seeAttachmentMatches.length > 0) {
      for (const m of seeAttachmentMatches) {
        const num = parseInt(m[1]);
        
        // Skip if we've already seen this attachment in a section (prefer section over pre-section)
        if (seenGlobally[num] && currentSec && seenGlobally[num] !== currentSec) {
          continue;
        }
        
        // Skip if we've already seen this attachment number in current section
        if (currentSec && seenInSec[currentSec]?.has(num)) {
          continue;
        }
        
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
        
        let fullDesc = desc;
        if (url) {
          if (!/available\s+at/i.test(fullDesc)) {
            fullDesc = `${fullDesc}, available at ${url}`;
          } else {
            fullDesc = fullDesc.replace(/(available\s+at)\s*[:\-–—]?\s*$/i, `$1 ${url}`);
          }
        }
        
        const item = { num, desc: cleanDesc(fullDesc) };
        foundItems.push(item);
        matchedAny = true;
      }
    }
    
    // Fallback: handle plain enumerations like "(12) Description, available at: URL"
    if (!matchedAny) {
      const m = trimmed.match(ITEM_ENUM_RE);
      if (m) {
        const num = parseInt(m[1]);
        
        // Skip if we've already seen this attachment in a section (prefer section over pre-section)
        if (seenGlobally[num] && currentSec && seenGlobally[num] !== currentSec) {
          continue;
        }
        
        // Skip if we've already seen this attachment number in current section
        if (currentSec && seenInSec[currentSec]?.has(num)) {
          continue;
        }
        
        let desc = (m[2] || '').trim().replace(/,$/, '');
        let url = (m[3] || '').trim();
        
        // Check for embedded "Attachment N -" references in the ENTIRE line and split them
        // Pattern: ", Attachment N - Description" where Description goes until next ", Attachment" or end
        const fullLine = trimmed;
        const embeddedPattern = /,\s*Attachment\s+(\d+)\s*[-–—]\s*/g;
        const embeddedMatches: Array<{num: number, descStart: number, descEnd: number, fullMatchStart: number}> = [];
        
        let match;
        embeddedPattern.lastIndex = 0;
        while ((match = embeddedPattern.exec(fullLine)) !== null) {
          const descStart = match.index + match[0].length;
          // Find where this description ends: either next ", Attachment" or end of line
          const remaining = fullLine.slice(descStart);
          const nextAttachment = remaining.match(/,\s*Attachment\s+\d+\s*[-–—]\s*/);
          const descEnd = nextAttachment ? descStart + (nextAttachment.index ?? 0) : fullLine.length;
          
          embeddedMatches.push({
            num: parseInt(match[1]),
            descStart: descStart,
            descEnd: descEnd,
            fullMatchStart: match.index
          });
        }
        
        if (embeddedMatches.length > 0) {
          // Remove embedded attachments from main description
          let cleanedDesc = desc;
          for (const emb of embeddedMatches) {
            // Remove the full ", Attachment N - Description" part
            const fullEmbText = fullLine.slice(emb.fullMatchStart, emb.descEnd);
            cleanedDesc = cleanedDesc.replace(fullEmbText, '').trim();
          }
          // Clean up any double commas or trailing commas
          desc = cleanedDesc.replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();
          
          // Add embedded attachments as separate items
          for (const emb of embeddedMatches) {
            let embDesc = fullLine.slice(emb.descStart, emb.descEnd).trim();
            
            // Look for URL in the embedded attachment description or after it
            let embUrl = '';
            // First check if URL is in the description itself
            const urlInDesc = embDesc.match(/available\s+at\s+[:\-–—]?\s*(https?:\/\/\S+)/i);
            if (urlInDesc) {
              embUrl = urlInDesc[1];
              embDesc = embDesc.replace(/available\s+at\s+[:\-–—]?\s*https?:\/\/\S+/i, '').trim();
            } else {
              // Check after the embedded attachment
              const embAfter = fullLine.slice(emb.descEnd);
              const urlMatch = embAfter.match(/available\s+at\s+[:\-–—]?\s*(https?:\/\/\S+)/i);
              if (urlMatch) {
                embUrl = urlMatch[1];
              }
            }
            
            // Skip if already seen
            if (seenGlobally[emb.num] && currentSec && seenGlobally[emb.num] !== currentSec) {
              continue;
            }
            if (currentSec && seenInSec[currentSec]?.has(emb.num)) {
              continue;
            }
            
            let fullEmbDesc = embDesc;
            if (embUrl) {
              fullEmbDesc = `${embDesc}, available at ${embUrl}`;
            }
            
            foundItems.push({ num: emb.num, desc: cleanDesc(fullEmbDesc) });
          }
        }
        
        // Look for URL anywhere in the line if not captured by regex
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
        
        foundItems.push({ num, desc: cleanDesc(fullDesc) });
      }
    }
    
    // Add found items to appropriate section
    for (const item of foundItems) {
      if (currentSec) {
        // We're in a section, add to it (and remove from pre-section if it was there)
        // Only add if we haven't seen it in a different section, or if it was in pre-section
        if (!seenGlobally[item.num] || preSectionItems[item.num]) {
          delete preSectionItems[item.num];
          bySec[currentSec].push(item);
          seenInSec[currentSec].add(item.num);
          seenGlobally[item.num] = currentSec;
        }
      } else {
        // Before first section, collect for later (only if not already in a section)
        if (!seenGlobally[item.num]) {
          preSectionItems[item.num] = item;
        }
      }
    }
  }
  
  // Final pass: deduplicate across sections (keep only first occurrence) and sort
  const result: GroupedAttachments = {};
  const finalSeen: Set<number> = new Set();
  
  // First, add pre-section items that weren't captured in any section
  // These appear before any section header and should be output first without a heading
  const preSectionList: Attachment[] = [];
  for (const num in preSectionItems) {
    const item = preSectionItems[num];
    if (!finalSeen.has(item.num)) {
      preSectionList.push(item);
      finalSeen.add(item.num);
    }
  }
  if (preSectionList.length > 0) {
    // Use empty string as key for pre-section items (will be rendered without heading)
    result[''] = preSectionList.sort((a, b) => a.num - b.num);
  }
  
  for (const sec in bySec) {
    const sectionItems: Attachment[] = [];
    for (const item of bySec[sec]) {
      if (!finalSeen.has(item.num)) {
        sectionItems.push(item);
        finalSeen.add(item.num);
      }
    }
    if (sectionItems.length > 0) {
      result[sec] = sectionItems.sort((a, b) => a.num - b.num);
    }
  }
  
  return result;
}
