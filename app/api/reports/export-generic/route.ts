import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, readJsonBody } from '@/lib/utils/errors';
import { neutralizeCsvFormula } from '@/lib/reports/csv';
import { apiError } from '@/lib/utils/api-error';

/**
 * Convert arbitrary table rows to CSV with UTF-8 BOM. Every cell passes
 * through formula neutralization (audit 07 M-4): =, +, -, @ prefixes would
 * otherwise execute as formulas when the file opens in Excel.
 */
function convertToCsv(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0] || {});
  const csvRows = [headers.join(',')];
  for (const row of data) {
    const values = headers.map((header) => {
      const val = row[header];
      if (val === null || val === undefined) return '""';
      const str = val instanceof Date ? val.toISOString() : typeof val === 'object' ? JSON.stringify(val) : String(val);
      const escaped = neutralizeCsvFormula(str).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return '\uFEFF' + csvRows.join('\r\n');
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Exports are reporting artifacts: require the REPORTS screen floor so a
    // plain Member cannot drive arbitrary data through the CSV pipeline
    // (audit 07 M-4).
    if (!hasScreenPermission(user, 'REPORTS', 'READ')) {
      throw new ForbiddenError('Read permission required for: REPORTS');
    }

    const body = await readJsonBody(request);
    const { title = 'export', data = [] } = body;

    if (!Array.isArray(data) || data.length === 0) {
      throw new ValidationError('A non-empty array of data is required for generic export');
    }

    // The payload is caller-supplied and is re-serialised cell by cell
    // (formula-neutralised) entirely in memory, so the array length is the only
    // thing that bounds the request. readJsonBody applies no byte cap, so bound
    // the row count here; the server-computed reports cap at REPORT_MAX_ROWS
    // and this endpoint should not be able to ask for more than they can emit.
    if (data.length > 5000) {
      throw new ValidationError('A generic export is limited to 5000 rows');
    }

    const csvContent = convertToCsv(data);
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'EXPORT_GENERIC_DATA',
      resourceType: 'Report',
      details: { title, rowCount: data.length },
    });

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('[EXPORT GENERIC ERROR]', err);
    return apiError(err, 'Generic export failed');
  }
}
