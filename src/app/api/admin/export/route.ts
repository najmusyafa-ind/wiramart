// =============================================================
// GET /api/admin/export — Export Laporan Penjualan & Backup Data (.xlsx)
// Query params:
//   type     = 'sales_report' | 'full' | 'transactions' | 'products' | 'employees'
//   period   = 'daily' | 'weekly' | 'monthly' | 'semi_annual' | 'october' | 'november' | 'oct_nov' | 'all'
//   dateFrom = YYYY-MM-DD (opsional, menimpa preset period)
//   dateTo   = YYYY-MM-DD (opsional)
// Auth: MANAGER only (requireManager)
// Kapasitas: Maks 10.000 baris per sheet (EXPORT_MAX_ROWS)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import {
  InvalidRangeError,
  isPeriodKey,
  resolveReportRange,
  wibToday,
  type PeriodKey,
  type ReportRange,
} from '@/lib/finance/report';
import {
  buildBackupWorkbook,
  buildSalesReportWorkbook,
  EXPORT_MAX_ROWS,
  type BackupExportType,
} from '@/lib/services/exportWorkbookService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExportType = 'sales_report' | BackupExportType;
const VALID_TYPES: readonly ExportType[] = [
  'sales_report',
  'full',
  'transactions',
  'products',
  'employees',
];

function isValidExportType(v: string | null): v is ExportType {
  return typeof v === 'string' && (VALID_TYPES as readonly string[]).includes(v);
}

function buildFilename(type: ExportType, range: ReportRange | null, todayWibStr: string): string {
  const periodSlug = range
    ? (range.period ?? `${range.startDate}_sd_${range.endDate}`)
    : 'semua';

  if (type === 'sales_report') {
    return `laporan-penjualan-wiramart-${periodSlug}-${todayWibStr}.xlsx`;
  }
  return `backup-smartkasir-${type}-${periodSlug}-${todayWibStr}.xlsx`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireManager();

    const { searchParams } = new URL(req.url);
    const rawType = searchParams.get('type') ?? 'full';
    const rawPeriod = searchParams.get('period');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    if (!isValidExportType(rawType)) {
      return NextResponse.json(
        { success: false, error: `Tipe export tidak valid. Pilih: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (rawPeriod && !isPeriodKey(rawPeriod)) {
      return NextResponse.json(
        { success: false, error: `Preset periode "${rawPeriod}" tidak dikenali.` },
        { status: 400 },
      );
    }

    const periodKey: PeriodKey | null = rawPeriod && isPeriodKey(rawPeriod) ? rawPeriod : null;
    const hasFilter = Boolean(periodKey || dateFrom || dateTo);

    let range: ReportRange | null = null;
    if (hasFilter) {
      range = resolveReportRange({ period: periodKey, dateFrom, dateTo });
    } else if (rawType === 'sales_report') {
      range = resolveReportRange({ period: 'monthly' });
    }

    const result =
      rawType === 'sales_report'
        ? await buildSalesReportWorkbook(range!)
        : await buildBackupWorkbook({ type: rawType, range });

    const todayWibStr = wibToday();
    const filename = buildFilename(rawType, range, todayWibStr);
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(result.buffer.byteLength),
        'Cache-Control': 'no-store',
        'X-Export-Max-Rows': String(EXPORT_MAX_ROWS),
        'X-Export-Truncated': result.truncatedSheets.join(', '),
      },
    });
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    if (err instanceof AppError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.statusCode });
    }
    console.error('[GET /api/admin/export] Error:', err);
    return NextResponse.json({ success: false, error: 'Export Excel gagal dibuat.' }, { status: 500 });
  }
}
