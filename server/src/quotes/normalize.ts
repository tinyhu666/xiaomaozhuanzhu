const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": "\"",
  "&#34;": "\"",
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&mdash;": "-",
  "&ndash;": "-",
  "&hellip;": "...",
  "&ldquo;": "\"",
  "&rdquo;": "\"",
  "&lsquo;": "'",
  "&rsquo;": "'"
};

export function decodeHtmlEntities(value: string) {
  return value.replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITY_MAP[entity] ?? entity);
}

export function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

export function normalizeQuoteText(value: string) {
  return stripHtml(value)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[。！？；：]/g, (match) => {
      const map: Record<string, string> = {
        "。": ".",
        "！": "!",
        "？": "?",
        "；": ";",
        "：": ":"
      };
      return map[match] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function buildQuoteFingerprint(quoteEn: string, quoteZh: string) {
  return `${simplifyFingerprint(quoteEn)}::${simplifyFingerprint(quoteZh)}`;
}

export function extractTextLines(fragment: string) {
  return stripHtml(fragment)
    .split(/\r?\n+/)
    .map((line) => normalizeQuoteText(line))
    .filter(Boolean);
}

export function isLikelyEnglish(value: string) {
  return /[A-Za-z]/.test(value) && !/[\u4e00-\u9fff]/.test(value);
}

export function isLikelyChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function simplifyFingerprint(value: string) {
  return normalizeQuoteText(value)
    .toLowerCase()
    .replace(/["'.,!?;:()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
