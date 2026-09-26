// =============================================================
// GET /api/health — Health check endpoint
// PRE-LAUNCH GATE: dipakai monitoring (Uptime Robot, Vercel Checks)
// Response shape: { status: 'ok'|'degraded', db, latencyMs, uptime, timestamp }
// Auth: NONE — public endpoint, jangan expose info sensitif
// =============================================================

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
// Wajib force-dynamic agar tidak di-cache oleh Vercel CDN
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const start = Date.now();

  // Check DB connectivity dengan query minimal
  let dbStatus: 'connected' | 'disconnected' = 'connected';
  let dbError: string | undefined;
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    dbStatus = 'disconnected';
    dbError = err instanceof Error ? err.message : 'unknown';
  }

  const latencyMs = Date.now() - start;
  const uptime = Math.floor(process.uptime());
  const isOk = dbStatus === 'connected';

  return Response.json(
    {
      status: isOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      env: process.env.NODE_ENV,
      uptime,
      latencyMs,
      db: {
        status: dbStatus,
        ...(dbError ? { error: dbError } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: isOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Health-Check': 'smartkasir-perwira',
      },
    },
  );
}
