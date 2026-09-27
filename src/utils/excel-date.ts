/**
 * Converts Excel serial dates or date strings into standardized ISO (YYYY-MM-DD) format
 */
export function formatExcelDate(val: any): string {
  if (!val || val === 'N/A' || val === '-' || val === 'undefined') return '';

  if (typeof val === 'number' && val > 25000 && val < 70000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }

  if (typeof val === 'string') {
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime()) && val.length >= 4) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return String(val).trim();
}
