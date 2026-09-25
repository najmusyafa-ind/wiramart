// =============================================================
// GET /api/health — Health check endpoint
// =============================================================

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const start = Date.now();

  // Check DB connectivity
  let dbStatus = 'connected';
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'disconnected';
  }

  const uptime = process.uptime();
  const latency = Date.now() - start;

  const status = dbStatus === 'connected' ? 'ok' : 'degraded';

  return Response.json(
    {
      status,
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor(uptime),
      db: dbStatus,
      latencyMs: latency,
      timestamp: new Date().toISOString(),
    },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
