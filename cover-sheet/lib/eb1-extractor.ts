// lib/eb1-extractor.ts - Port of eb1_cover.py logic
export interface Attachment {
  num: number;
  desc: string;
}

export interface GroupedAttachments {
  [section: string]: Attachment[];
}

// Include multiple dash variants: hyphen, en-dash, em-dash, minus, and others
const DASH_CHARS = '\\-–—−‐‑‒―';

// Also handle "(See Attachment N – ...)" format embedded in paragraphs
const SEE_ATTACHMENT_RE = new RegExp(`\\(See\\s+Attachment\\s+(\\d+)\\s*[${DASH_CHARS}]\\s*(.+?)(?:,?\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*(https?:\\/\\/[^\\s)]+))?\\s*\\)`, 'gi');

const ITEM_ENUM_RE = new RegExp(`^\\s*\\((\\d+)\\)\\s*(.+?)(?:,\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*(https?:\\/\\/\\S+))?\\s*\\.?\\s*$`, 'i');

// Pattern to detect embedded attachments like ", Attachment 48 – Description"
// Include multiple dash variants: hyphen, en-dash, em-dash, minus, and others
// Make dash optional to handle cases like ", Attachment 48 Description"
const EMBEDDED_ATTACHMENT_RE = /,\s*Attachment\s+(\d+)\s*[-–—−‐‑‒―]?\s*/gi;

const URL_IN_TEXT_RE = /https?:\/\/\S+/g;

// Match section headers but EXCLUDE table of contents entries (which end with page numbers like "(Pages 17-26)" or just page numbers)
const SECTION_LINE_RE = /^\s*(?:EVIDENCE\b.*|DOCUMENTATION TO ESTABLISH\b.*|SUSTAINED NATIONAL OR INTERNATIONAL ACCLAIM\b.*)$/i;
const TOC_LINE_RE = /\(Pages?\s*[\d\-–—,\s]+\)\s*[;.]?\s*$/i; // TOC entries end with "(Pages X-Y)" or similar

function normalizeHeadingPronouns(titleUpper: string): string {
  // Operates on UPPERCASE headings only.
  let t = titleUpper;

  // Common phrases first (to keep grammar reasonable where easy)
  t = t.replace(/\bABOUT\s+ME\b/g, 'ABOUT PETITIONER');
  t = t.replace(/\bTHAT\s+MY\s+COMMAND\b/g, 'THAT PETITIONER COMMANDS'); // "MY COMMAND" -> "PETITIONER COMMANDS"
  t = t.replace(/\bTHAT\s+I\s+COMMAND\b/g, 'THAT PETITIONER COMMANDS');
  t = t.replace(/\bTHAT\s+I\s+HAVE\b/g, 'THAT PETITIONER HAS');
  t = t.replace(/\bTHAT\s+I\s+AM\b/g, 'THAT PETITIONER IS');
  t = t.replace(/\bTHAT\s+I\s+WILL\b/g, 'THAT PETITIONER WILL');
  t = t.replace(/\bTHAT\s+I\b/g, 'THAT PETITIONER');
  t = t.replace(/\bOF\s+MY\b/g, "OF PETITIONER'S");

  // Generic replacements - but be careful with "MY COMMAND" which should become "PETITIONER COMMANDS"
  // Already handled above, so now handle remaining MY
  t = t.replace(/\bMY\b/g, "PETITIONER'S");
  // Replace standalone pronoun I (avoid touching words like "IN")
  t = t.replace(/(^|[^A-Z])I([^A-Z]|$)/g, '$1PETITIONER$2');
  t = t.replace(/\bME\b/g, 'PETITIONER');

  return t;
}

function cleanDesc(raw: string): string {
  let desc = raw.trim().replace(/\s+/g, ' ');
  
  // Remove page references like ", pages 24-25" or ", page 50" or ", pp. 24-25"
  desc = desc.replace(/,?\s*(?:pages?|pp\.?)\s*[\d\-–—,\s]+/gi, '');
  
  // Normalize weird "is, available at" and spacing
  desc = desc.replace(/\bis,\s*available\s+at\b/gi, 'is available at');
  
  // Normalize "available at"
  desc = desc.replace(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*/gi, ', available at ');
  
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
  // Use empty string key for pre-section attachments (will render without heading)
  let currentSection: string = '';
  groups[''] = [];
  
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // Detect section headers (exclude CONCLUSION and TOC entries)
    // TOC entries have page numbers like "(Pages 17-26)" at the end
    if (SECTION_LINE_RE.test(trimmed) && !/CONCLUSION/i.test(trimmed) && !TOC_LINE_RE.test(trimmed)) {
      let title = trimmed.replace(/\s+/g, ' ').toUpperCase();
      // Remove "(PAGES ...)" from section titles
      title = title.replace(/\s*\(PAGES?\s+[\d\-–—,\s]+\)/gi, '');
      // Remove trailing punctuation like semicolons or periods
      title = title.replace(/[;.]+$/, '').trim();
      // Normalize pronouns (I / MY / ME) -> PETITIONER
      title = normalizeHeadingPronouns(title);
      
      // Normalize similar section names to prevent duplicates
      if (/EVIDENCE.*LEADING.*CRITICAL.*ROLE/i.test(title)) {
        title = 'EVIDENCE OF LEADING OR CRITICAL ROLE IN AN ORGANIZATION';
      }
      if (/EVIDENCE.*MEMBERSHIP.*ASSOCIATIONS.*(?:THAT|WHICH).*DEMAND/i.test(title)) {
        title = "EVIDENCE OF PETITIONER'S MEMBERSHIP IN ASSOCIATIONS IN THE FIELD WHICH DEMAND OUTSTANDING ACHIEVEMENT OF THEIR MEMBERS";
      }
      
      currentSection = title;
      if (!groups[currentSection]) {
        groups[currentSection] = [];
      }
      continue;
    }
    
    let matchedAny = false;
    
    // Check for "Attachment N - Description" format (common for pre-section items)
    // Pattern: starts with "Attachment" followed by number and dash
    const attachmentLineMatch = trimmed.match(/^Attachment\s+(\d+)\s*[-–—−‐‑‒―]\s*(.+?)(?:,\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*(https?:\/\/\S+))?\s*\.?\s*$/i);
    if (attachmentLineMatch) {
      const num = parseInt(attachmentLineMatch[1]);
      let desc = (attachmentLineMatch[2] || '').trim().replace(/,$/, '');
      let url = (attachmentLineMatch[3] || '').trim();
      
      // Look for URL in the description if not captured
      if (!url) {
        const urlMatch = desc.match(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*(https?:\/\/\S+)/i);
        if (urlMatch) {
          url = urlMatch[1];
          desc = desc.replace(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*https?:\/\/\S+/i, '').trim();
        }
      }
      
      let fullDesc = desc;
      if (url) {
        fullDesc = `${desc}, available at ${url}`;
      }
      
      groups[currentSection].push({ num, desc: cleanDesc(fullDesc) });
      matchedAny = true;
    }
    
    // First, check for "(See Attachment N – ...)" format
    const seeAttachmentMatches = !matchedAny ? Array.from(trimmed.matchAll(SEE_ATTACHMENT_RE)) : [];
    if (seeAttachmentMatches.length > 0) {
      const pairs: Attachment[] = [];
      
      for (const m of seeAttachmentMatches) {
        const num = parseInt(m[1]);
        let desc = (m[2] || '').trim().replace(/,$/, '');
        let url = (m[3] || '').trim();
        
        // Look for URL in the rest of the paragraph if not captured
        if (!url) {
          const restOfPara = trimmed.slice((m.index || 0) + m[0].length);
          const urlMatch = restOfPara.match(new RegExp(`available\\s+at\\s+[:${DASH_CHARS}]?\\s*(https?:\\/\\/\\S+)`, 'i'));
          if (urlMatch) {
            url = urlMatch[1];
          }
        }
        
        // Check for embedded attachments like ", Attachment 2 - Description"
        const embeddedAttachments: Attachment[] = [];
        const embeddedPattern = new RegExp(`,?\\s*Attachment\\s+(\\d+)\\s*[-–—−‐‑‒―]?\\s*`, 'gi');
        
        if (embeddedPattern.test(desc)) {
          // Split by embedded attachment pattern
          const parts = desc.split(/,?\s*Attachment\s+\d+\s*[-–—−‐‑‒―]?\s*/i);
          const embNums = [...desc.matchAll(/,?\s*Attachment\s+(\d+)\s*[-–—−‐‑‒―]?\s*/gi)];
          
          // First part is the main description
          let mainDesc = (parts[0] || '').trim().replace(/,$/, '');
          let mainUrl = '';
          
          // Extract URL from main description if present
          const mainUrlMatch = mainDesc.match(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*(https?:\/\/\S+)/i);
          if (mainUrlMatch) {
            mainUrl = mainUrlMatch[1];
            mainDesc = mainDesc.replace(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*https?:\/\/\S+/i, '').trim();
          }
          
          // Process embedded attachments
          for (let i = 0; i < embNums.length; i++) {
            const embNum = parseInt(embNums[i][1]);
            let embDesc = (parts[i + 1] || '').trim().replace(/,$/, '');
            let embUrl = '';
            
            // Extract URL from embedded description if present
            const embUrlMatch = embDesc.match(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*(https?:\/\/\S+)/i);
            if (embUrlMatch) {
              embUrl = embUrlMatch[1];
              embDesc = embDesc.replace(/,?\s*available\s+at\s*[:|\-–—−‐‑‒―]?\s*https?:\/\/\S+/i, '').trim();
            }
            
            let fullEmbDesc = embDesc;
            if (embUrl) {
              fullEmbDesc = `${embDesc}, available at ${embUrl}`;
            }
            
            if (embDesc) {
              embeddedAttachments.push({ num: embNum, desc: cleanDesc(fullEmbDesc) });
            }
          }
          
          // Update main description
          desc = mainDesc;
          if (mainUrl && !url) {
            url = mainUrl;
          }
        }
        
        // Build final description for main item
        let fullDesc = desc;
        if (url) {
          if (!/available\s+at/i.test(fullDesc)) {
            fullDesc = `${fullDesc}, available at ${url}`;
          } else {
            fullDesc = fullDesc.replace(new RegExp(`(available\\s+at)\\s*[:${DASH_CHARS}]?\\s*$`, 'i'), `$1 ${url}`);
          }
        }
        
        pairs.push({ num, desc: cleanDesc(fullDesc) });
        
        // Add embedded attachments
        for (const emb of embeddedAttachments) {
          pairs.push(emb);
        }
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
          const found = trimmed.match(new RegExp(`available\\s+at\\s+[:${DASH_CHARS}]?\\s*(https?:\\/\\/\\S+)`, 'i'));
          if (found) {
            url = found[1];
          }
        }
        
        // Check for embedded attachments like ", Attachment 48 – Description"
        // This handles cases like: "(1) Cert A, Attachment 2 - Cert B, Attachment 3 - Cert C."
        const embeddedAttachments: Attachment[] = [];
        
        // Split by embedded attachment pattern - don't use test() first to avoid global regex issues
        // Pattern: ", Attachment N -" or ", Attachment N " (dash optional)
        const embeddedSplitPattern = /,\s*Attachment\s+(\d+)\s*[-–—−‐‑‒―]?\s*/gi;
        const parts = desc.split(embeddedSplitPattern);
        
        // If we got more than 1 part, there were embedded attachments
        // parts structure: ["mainDesc", "num1", "desc1", "num2", "desc2", ...]
        if (parts.length > 1) {
          // Get the main description (before first embedded attachment)
          let mainDesc = parts[0].trim().replace(/,\s*$/, '');
          
          // If main description has "available at URL" at the end, extract it
          let mainUrl = '';
          const mainUrlMatch = mainDesc.match(new RegExp(`,?\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*(https?:\\/\\/\\S+)\\s*$`, 'i'));
          if (mainUrlMatch) {
            mainUrl = mainUrlMatch[1].replace(/,$/, ''); // Remove trailing comma from URL
            mainDesc = mainDesc.replace(new RegExp(`,?\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*https?:\\/\\/\\S+\\s*$`, 'i'), '').trim();
          }
          
          // Process pairs: (num at odd index, desc at next even index)
          for (let i = 1; i < parts.length; i += 2) {
            const embNum = parseInt(parts[i]);
            if (isNaN(embNum)) continue; // Skip if not a valid number
            
            let embDesc = (parts[i + 1] || '').trim().replace(/,\s*$/, '').replace(/\.\s*$/, '').replace(/[-–—−‐‑‒―]\s*$/, '').trim();
            
            // Check if this embedded description has a URL
            let embUrl = '';
            const urlInEmb = embDesc.match(new RegExp(`,?\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*(https?:\\/\\/\\S+)`, 'i'));
            if (urlInEmb) {
              embUrl = urlInEmb[1].replace(/,$/, '');
              embDesc = embDesc.replace(new RegExp(`,?\\s*available\\s+at\\s*[:${DASH_CHARS}]?\\s*https?:\\/\\/\\S+`, 'i'), '').trim();
            }
            
            let fullEmbDesc = embDesc;
            if (embUrl) {
              fullEmbDesc = `${embDesc}, available at ${embUrl}`;
            }
            
            if (embDesc) { // Only add if there's actually a description
              embeddedAttachments.push({ num: embNum, desc: cleanDesc(fullEmbDesc) });
            }
          }
          
          // Update main description
          desc = mainDesc;
          // If we extracted a URL from main desc, use it
          if (mainUrl && !url) {
            url = mainUrl;
          }
        }
        
        let fullDesc = desc;
        if (url && !/available\s+at/i.test(fullDesc)) {
          fullDesc = `${fullDesc}, available at ${url}`;
        } else if (url) {
          fullDesc = fullDesc.replace(new RegExp(`(available\\s+at)\\s*[:${DASH_CHARS}]?\\s*$`, 'i'), `$1 ${url}`);
        }
        
        groups[currentSection].push({ num, desc: cleanDesc(fullDesc) });
        
        // Add embedded attachments as separate items
        for (const emb of embeddedAttachments) {
          groups[currentSection].push(emb);
        }
      }
    }
  }
  
  // Final pass: dedupe per section and remove empty sections
  const result: GroupedAttachments = {};
  
  // First, handle pre-section attachments (empty key) - put them first
  if (groups[''] && groups[''].length > 0) {
    const deduped = dedupeBest(groups['']);
    if (deduped.length > 0) {
      result[''] = deduped;
    }
  }
  
  // Then handle all other sections
  for (const sect in groups) {
    if (sect === '') continue; // Already handled above
    const deduped = dedupeBest(groups[sect]);
    if (deduped.length > 0) {
      result[sect] = deduped;
    }
  }
  
  return result;
}
