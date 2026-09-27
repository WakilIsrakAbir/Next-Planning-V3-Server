/**
 * Escapes all regular expression special characters to prevent ReDoS (Regex Denial of Service)
 * and NoSQL regex injection.
 */
export function escapeRegex(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
