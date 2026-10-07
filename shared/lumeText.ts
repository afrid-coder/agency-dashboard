// Lume writes record links as tokens like [[task:ID]]. The server keeps only
// tokens for records it actually retrieved; the interface renders them as
// links showing the record's title.
export const TOKEN_RE = /\[\[(task|event|project|client|profit|note):([A-Za-z0-9-]{1,64})\]\]/g;

export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => `${m[1]}:${m[2]}`);
}

/** Removes tokens that don't refer to a known record. */
export function sanitizeTokens(text: string, allowed: Set<string>): string {
  return text
    .replace(TOKEN_RE, (full, type, id) => (allowed.has(`${type}:${id}`) ? full : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1');
}

/** Money amounts written in text, e.g. "$1,250" or "$80.50". */
export function moneyIn(text: string): string[] {
  return [...text.matchAll(/−?-?\$\d[\d,]*(?:\.\d{2})?/g)].map((m) => m[0].replace('-', '−'));
}
