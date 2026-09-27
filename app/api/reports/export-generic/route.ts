import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError } from '@/lib/utils/errors';

/**
 * Convert arbitrary table rows to CSV with UTF-8 BOM.
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
      const escaped = str.replace(/"/g, '""');
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

    const body = await request.json();
    const { title = 'export', data = [] } = body;

    if (!Array.isArray(data) || data.length === 0) {
      throw new ValidationError('A non-empty array of data is required for generic export');
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
    return NextResponse.json(
      { success: false, message: err.message || 'Generic export failed' },
      { status: err.statusCode || 500 }
    );
  }
}
