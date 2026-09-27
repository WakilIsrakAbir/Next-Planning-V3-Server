export function normKey(key: any): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildKeyMap(row: Record<string, any>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rk in row) {
    map[normKey(rk)] = rk;
  }
  return map;
}

export function getVal(
  row: Record<string, any>,
  candidateKeys: string[],
  keyMap: Record<string, string>
): any {
  for (const k of candidateKeys) {
    const norm = normKey(k);
    if (keyMap[norm] !== undefined) {
      const val = row[keyMap[norm]];
      return val === undefined || val === null ? '' : val;
    }
  }
  return '';
}
