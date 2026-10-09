import { Finding, ReportRow } from './api';
import { statusOf } from './presentation';

export const queryFields = ['finding_id', 'report_id', 'scanned_at', 'account_id', 'region', 'status', 'severity', 'type', 'category', 'resource', 'title'] as const;
export type QueryField = typeof queryFields[number];
type QueryValue = string | number;
type Predicate = { field: QueryField; operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'CONTAINS'; value: QueryValue };
type ParsedQuery = { columns: QueryField[]; predicates: Predicate[]; sort?: { field: QueryField; direction: 'ASC' | 'DESC' }; limit: number };
export type QueryRow = Record<QueryField, string | number | undefined>;
type Token = { value: string; quoted?: boolean; number?: boolean };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < source.length;) {
    if (/\s/.test(source[index])) { index++; continue; }
    if (source[index] === "'") {
      let value = ''; index++;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") { value += "'"; index += 2; }
        else if (source[index] === "'") { index++; closed = true; break; }
        else value += source[index++];
      }
      if (!closed) throw new Error('String values must end with a single quote.');
      tokens.push({ value, quoted: true });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (['!=', '<=', '>='].includes(two)) { tokens.push({ value: two }); index += 2; continue; }
    if ([',', '*', '=', '<', '>'].includes(source[index])) { tokens.push({ value: source[index++] }); continue; }
    const number = source.slice(index).match(/^\d+/);
    if (number) { tokens.push({ value: number[0], number: true }); index += number[0].length; continue; }
    const word = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) { tokens.push({ value: word[0] }); index += word[0].length; continue; }
    throw new Error(`Unsupported character at position ${index + 1}.`);
  }
  return tokens;
}

function parse(source: string): ParsedQuery {
  if (source.length > 4000) throw new Error('Query must be 4000 characters or fewer.');
  const tokens = tokenize(source.trim()); let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const keyword = (value: string) => !peek()?.quoted && peek()?.value.toUpperCase() === value;
  const requireKeyword = (value: string) => { if (!keyword(value.toUpperCase())) throw new Error(`Expected ${value.toLowerCase()}.`); take(); };
  const field = (): QueryField => {
    const token = take();
    const normalized = token && !token.quoted ? token.value.toLowerCase() : '';
    if (!queryFields.includes(normalized as QueryField)) throw new Error(`Unsupported field "${token?.value || ''}".`);
    return normalized as QueryField;
  };
  const valueFor = (name: QueryField): QueryValue => {
    const token = take();
    if (!token || (!token.quoted && !token.number)) throw new Error('Expected a quoted string or integer value.');
    if (name === 'report_id') {
      if (!token.number || !Number.isSafeInteger(Number(token.value))) throw new Error('report_id comparisons require an integer.');
      return Number(token.value);
    }
    if (token.number) throw new Error(`The ${name} field requires a quoted string value.`);
    if (!token.value) throw new Error('Filter values cannot be empty.');
    return token.value;
  };
  requireKeyword('SELECT');
  const columns: QueryField[] = [];
  if (peek()?.value === '*') { take(); columns.push(...queryFields); }
  else {
    columns.push(field());
    while (peek()?.value === ',') { take(); columns.push(field()); }
    if (new Set(columns).size !== columns.length) throw new Error('Selected fields cannot be repeated.');
  }
  requireKeyword('FROM'); requireKeyword('FINDINGS');
  const predicates: Predicate[] = [];
  if (keyword('WHERE')) {
    take();
    do {
      const name = field(); const operatorToken = take();
      const operator = operatorToken?.value.toUpperCase();
      if (!['=', '!=', '<', '<=', '>', '>=', 'CONTAINS'].includes(operator || '')) throw new Error('Use =, !=, <, <=, >, >=, or CONTAINS in filters.');
      if (['<', '<=', '>', '>='].includes(operator!) && !['report_id', 'scanned_at'].includes(name)) throw new Error(`Ordering comparisons are not supported for ${name}.`);
      if (operator === 'CONTAINS' && name === 'report_id') throw new Error('CONTAINS requires a text field.');
      const value = valueFor(name);
      if (name === 'scanned_at' && !Number.isFinite(Date.parse(String(value)))) throw new Error('scanned_at comparisons require a valid date string.');
      predicates.push({ field: name, operator: operator as Predicate['operator'], value });
      if (predicates.length > 10) throw new Error('Use at most 10 filters.');
      if (keyword('AND')) take();
      else break;
    } while (cursor < tokens.length);
  }
  let sort: ParsedQuery['sort'];
  if (keyword('ORDER')) {
    take(); requireKeyword('BY');
    const name = field();
    const direction = keyword('DESC') ? (take(), 'DESC') : keyword('ASC') ? (take(), 'ASC') : 'ASC';
    sort = { field: name, direction };
  }
  let limit = 100;
  if (keyword('LIMIT')) {
    take(); const token = take();
    if (!token?.number) throw new Error('LIMIT must be an integer from 1 to 500.');
    limit = Number(token.value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('LIMIT must be an integer from 1 to 500.');
  }
  if (cursor !== tokens.length) throw new Error(`Unexpected token "${peek()?.value}".`);
  return { columns, predicates, sort, limit };
}

function compare(actual: QueryRow[QueryField], predicate: Predicate): boolean {
  if (actual === undefined) return false;
  if (predicate.field === 'status' && ['UNKNOWN', 'SKIPPED'].includes(String(actual)) && predicate.operator !== '=' ) return false;
  if (predicate.operator === 'CONTAINS') return typeof actual === 'string' && actual.toLowerCase().includes(String(predicate.value).toLowerCase());
  if (predicate.operator === '=' || predicate.operator === '!=') {
    const equal = typeof actual === 'number' ? actual === predicate.value : String(actual).toLowerCase() === String(predicate.value).toLowerCase();
    return predicate.operator === '=' ? equal : !equal;
  }
  const left = predicate.field === 'scanned_at' ? Date.parse(String(actual)) : Number(actual);
  const right = predicate.field === 'scanned_at' ? Date.parse(String(predicate.value)) : Number(predicate.value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (predicate.operator === '<') return left < right;
  if (predicate.operator === '<=') return left <= right;
  if (predicate.operator === '>') return left > right;
  return left >= right;
}

export function flattenReports(reports: ReportRow[]): QueryRow[] {
  return reports.flatMap(report => (Array.isArray(report.report.findings) ? report.report.findings : []).map((finding: Finding) => ({
    finding_id: finding.id,
    report_id: report.id,
    scanned_at: report.report.completed_at || report.created_at,
    account_id: report.report.context?.account_id,
    region: finding.region || report.report.context?.region,
    status: statusOf(finding),
    severity: finding.severity,
    type: finding.type,
    category: finding.category,
    resource: finding.resource,
    title: finding.title || finding.type,
  })));
}

export function runReportQuery(rows: QueryRow[], source: string) {
  const query = parse(source);
  let results = rows.filter(row => query.predicates.every(predicate => compare(row[predicate.field], predicate)));
  if (query.sort) {
    const { field: name, direction } = query.sort;
    const factor = direction === 'ASC' ? 1 : -1;
    results = [...results].sort((a, b) => {
      const left = a[name]; const right = b[name];
      if (left === undefined) return right === undefined ? 0 : 1;
      if (right === undefined) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), 'en', { numeric: true, sensitivity: 'base' }) * factor;
    });
  }
  const limited = results.slice(0, query.limit);
  return { columns: query.columns, rows: limited.map(row => Object.fromEntries(query.columns.map(name => [name, row[name]]))), total: limited.length };
}
