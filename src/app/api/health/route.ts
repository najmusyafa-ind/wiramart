// =============================================================
// GET /api/health — Health check endpoint
// PRE-LAUNCH GATE: dipakai monitoring (Uptime Robot, Vercel Checks)
// Response shape: { status: 'ok'|'degraded', db: { status }, latencyMs, timestamp }
// Auth: NONE — public endpoint, jangan expose info sensitif atau detail error internal
// =============================================================

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
// Wajib force-dynamic agar tidak di-cache oleh Vercel CDN
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 3000;

/** Checks database connectivity within a bounded timeout without leaking internal errors. */
async function checkDatabaseConnectivity(): Promise<'connected' | 'disconnected'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  // Swallow late rejections after timeout so Node never sees an unhandledRejection.
  const queryPromise = db.execute(sql`SELECT 1`).then(
    () => ({ ok: true as const }),
    (err: unknown) => {
      if (!timedOut) {
        console.error('[health] DB connectivity check failed:', err instanceof Error ? err.message : 'unknown');
      }
      return { ok: false as const };
    },
  );

  const timeoutPromise = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      console.error(`[health] DB connectivity check timed out after ${DB_TIMEOUT_MS}ms`);
      resolve({ ok: false });
    }, DB_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([queryPromise, timeoutPromise]);
    return result.ok ? 'connected' : 'disconnected';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const start = Date.now();
  const dbStatus = await checkDatabaseConnectivity();
  const latencyMs = Date.now() - start;
  const isOk = dbStatus === 'connected';

  return Response.json(
    {
      status: isOk ? 'ok' : 'degraded',
      db: { status: dbStatus },
      latencyMs,
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
