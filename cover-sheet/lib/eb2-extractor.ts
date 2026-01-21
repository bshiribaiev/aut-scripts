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
// Pattern to detect embedded attachments like ", Attachment 48 – Description"
// Using capturing group so split() includes the number in results
const EMBEDDED_ATTACHMENT_RE = /,\s*Attachment\s+(\d+)\s*[-–—]\s*/gi;
const ITEM_ENUM_RE = /^\s*\((\d+)\)\s*(.+?)(?:,?\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/\S+))?\s*\.?\s*$/i;
const URL_IN_TEXT_RE = /https?:\/\/\S+/g;

function normalizeHeadingPronouns(title: string): string {
  // Operates on section headings - replace I/MY/ME with PETITIONER
  let t = title.toUpperCase();

  // Common phrases first (to keep grammar reasonable where easy)
  t = t.replace(/\bABOUT\s+ME\b/g, 'ABOUT PETITIONER');
  t = t.replace(/\bOF\s+MY\b/g, "OF PETITIONER'S");
  t = t.replace(/\bTHAT\s+I\s+COMMAND\b/g, 'THAT PETITIONER COMMANDS');
  t = t.replace(/\bTHAT\s+I\s+HAVE\b/g, 'THAT PETITIONER HAS');
  t = t.replace(/\bTHAT\s+I\s+AM\b/g, 'THAT PETITIONER IS');
  t = t.replace(/\bTHAT\s+I\s+WILL\b/g, 'THAT PETITIONER WILL');
  t = t.replace(/\bTHAT\s+I\b/g, 'THAT PETITIONER');

  // Generic replacements
  t = t.replace(/\bMY\b/g, "PETITIONER'S");
  // Replace standalone pronoun I (avoid touching words like "IN")
  t = t.replace(/(^|[^A-Z])I([^A-Z]|$)/g, '$1PETITIONER$2');
  t = t.replace(/\bME\b/g, 'PETITIONER');

  return t;
}

function cleanDesc(raw: string): string {
  let desc = raw.trim();
  
  // Transform standalone "CV" to "Petitioner's CV" (if not already prefixed)
  if (!/Petitioner['']?s\s+CV/i.test(desc)) {
    desc = desc.replace(/\bCV\b/g, "Petitioner's CV");
  }
  
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
      let cleanSec = newSec.replace(/\s+\d+\s*$/, '').trim();
      // Normalize pronouns (I/MY/ME -> PETITIONER)
      cleanSec = normalizeHeadingPronouns(cleanSec);
      
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
        
        // Check for embedded attachments like ", Attachment 48 – Description"
        EMBEDDED_ATTACHMENT_RE.lastIndex = 0;
        if (EMBEDDED_ATTACHMENT_RE.test(desc)) {
          // Reset regex state
          EMBEDDED_ATTACHMENT_RE.lastIndex = 0;
          
          // Split by embedded attachment pattern (with capturing group)
          // JS split with capturing groups includes captured values in result:
          // "A, Attachment 48 – B, Attachment 49 – C".split(pattern)
          // => ["A", "48", "B", "49", "C"]
          // So: parts[0]=mainDesc, parts[1]=num1, parts[2]=desc1, parts[3]=num2, parts[4]=desc2, ...
          const parts = desc.split(EMBEDDED_ATTACHMENT_RE);
          
          // Get the main description (before first embedded attachment)
          const mainDesc = parts[0].trim().replace(/,\s*$/, '');
          
          // Process pairs: (num at odd index, desc at next even index)
          for (let i = 1; i < parts.length - 1; i += 2) {
            const embNum = parseInt(parts[i]);
            let embDesc = (parts[i + 1] || '').trim().replace(/,\s*$/, '').replace(/\.\s*$/, '');
            
            // Skip if already seen
            if (seenGlobally[embNum] && currentSec && seenGlobally[embNum] !== currentSec) {
              continue;
            }
            if (currentSec && seenInSec[currentSec]?.has(embNum)) {
              continue;
            }
            
            // Check if this embedded description has a URL
            let embUrl = '';
            const urlInEmb = embDesc.match(/,?\s*available\s+at\s*[:\-–—]?\s*(https?:\/\/\S+)/i);
            if (urlInEmb) {
              embUrl = urlInEmb[1];
              embDesc = embDesc.replace(/,?\s*available\s+at\s*[:\-–—]?\s*https?:\/\/\S+/i, '').trim();
            }
            
            let fullEmbDesc = embDesc;
            if (embUrl) {
              fullEmbDesc = `${embDesc}, available at ${embUrl}`;
            }
            
            foundItems.push({ num: embNum, desc: cleanDesc(fullEmbDesc) });
          }
          
          // Update main description to only include text before embedded attachments
          desc = mainDesc;
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
