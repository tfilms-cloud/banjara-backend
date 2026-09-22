export function paramId(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? String(value[0]) : String(value);
}
