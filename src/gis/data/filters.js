/** CQL literal escaping is shared by structured queries and the legacy spatial UI. */
export function quoteValue(value) {
  return typeof value === 'string'
    ? `'${value.replace(/'/g, "''")}'`
    : String(value);
}
export function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}
