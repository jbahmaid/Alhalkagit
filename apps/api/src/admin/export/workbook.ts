import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import ar from './i18n/ar.json';
import en from './i18n/en.json';

export type ExportLocale = 'ar' | 'en';
export type ExportDict = typeof ar;
export const EXPORT_DICT: Record<ExportLocale, ExportDict> = { ar, en };

export type ColumnKey = keyof ExportDict['cols'];
export type SheetKey = keyof ExportDict['sheets'];

/**
 * text: stored as text (numFmt "@"), so phone and ID numbers keep their leading zeros.
 * date / datetime: real Excel dates. datetime is shown in Saudi time (UTC+3, no DST).
 * percent: 0..100 shown as a percentage.
 * count: a number, or a text note in its place (a report group hidden for privacy).
 */
export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'percent' | 'count';

export interface ColumnSpec<T> {
  key: ColumnKey;
  type?: ColumnType;
  width?: number;
  value: (row: T) => string | number | Date | null | undefined;
}

export interface SheetSpec<T = any> {
  key: SheetKey;
  columns: ColumnSpec<T>[];
  /** Rows in chunks, so large tables are never held in memory at once. */
  rows: () => AsyncIterable<T[]>;
}

const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Excel's cell limit is 32,767 characters. */
const CELL_MAX = 32_000;

const NUM_FMT: Record<ColumnType, string | undefined> = {
  text: '@',
  number: undefined,
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  percent: '0%',
  count: undefined,
};

const DEFAULT_WIDTH: Record<ColumnType, number> = {
  text: 22,
  number: 12,
  date: 13,
  datetime: 18,
  percent: 12,
  count: 18,
};

function cellValue(type: ColumnType, v: string | number | Date | null | undefined): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'text': {
      const s = String(v);
      return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
    }
    case 'date':
      return v instanceof Date ? v : new Date(String(v));
    case 'datetime': {
      const d = v instanceof Date ? v : new Date(String(v));
      // Excel dates have no time zone: write the wall-clock time in Saudi Arabia.
      return new Date(d.getTime() + SAUDI_OFFSET_MS);
    }
    case 'percent':
      return Number(v) / 100;
    case 'count':
      return typeof v === 'number' ? v : String(v);
    default:
      return typeof v === 'number' ? v : Number(v);
  }
}

/** Sheet names: at most 31 characters, none of : \ / ? * [ ]. */
function sheetName(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
}

/**
 * Streams an .xlsx into `out` (an HTTP response, never a file): one sheet per spec, headers in
 * the admin's language, right-to-left for Arabic, bold frozen header row with auto filter.
 * Returns the number of data rows written per sheet.
 */
export async function writeWorkbook(
  out: Writable,
  locale: ExportLocale,
  sheets: SheetSpec[],
): Promise<Record<string, number>> {
  const t = EXPORT_DICT[locale];
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: out,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = 'Sanad';
  wb.created = new Date();
  const counts: Record<string, number> = {};

  for (const spec of sheets) {
    const ws = wb.addWorksheet(sheetName(t.sheets[spec.key]), {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: locale === 'ar' }],
    });
    ws.columns = spec.columns.map((c) => {
      const type = c.type ?? 'text';
      const fmt = NUM_FMT[type];
      return {
        key: c.key,
        width: c.width ?? Math.max(DEFAULT_WIDTH[type], Math.min(40, t.cols[c.key].length + 4)),
        ...(fmt ? { style: { numFmt: fmt } } : {}),
      };
    });
    const header = ws.addRow(spec.columns.map((c) => t.cols[c.key]));
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.commit();
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };

    let n = 0;
    for await (const chunk of spec.rows()) {
      for (const row of chunk) {
        ws.addRow(spec.columns.map((c) => cellValue(c.type ?? 'text', c.value(row)))).commit();
        n++;
      }
    }
    counts[spec.key] = n;
    ws.commit();
  }
  await wb.commit();
  return counts;
}

/** Pages through a query in fixed-size chunks (skip/take on a stable order). */
export async function* chunked<T>(
  fetch: (skip: number, take: number) => Promise<T[]>,
  size = 500,
  limit = Infinity,
) {
  let skip = 0;
  while (skip < limit) {
    const take = Math.min(size, limit - skip);
    const rows = await fetch(skip, take);
    if (rows.length) yield rows;
    if (rows.length < take) return;
    skip += rows.length;
  }
}
