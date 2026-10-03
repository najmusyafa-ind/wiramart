// =============================================================
// Void SEMUA transaksi COMPLETED pada hari ini (zona WIB)
// Logika identik dengan POST /api/admin/transaksi/[id]/void:
//   status -> VOID, stok dikembalikan, audit_logs dicatat (ATOMIC).
//
// Usage:
//   Dry-run : npx tsx --env-file=.env.local scripts/void-transaksi-hari-ini.ts
//   Execute : npx tsx --env-file=.env.local scripts/void-transaksi-hari-ini.ts --execute
// =============================================================

import { and, eq, gte, lt, sql, asc } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import {
  admins,
  auditLogs,
  products,
  transactionItems,
  transactions,
} from '../src/lib/db/schema';

const ALASAN = 'Data testing / uji coba';
const EXECUTE = process.argv.includes('--execute');
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Rentang [00:00, 24:00) hari ini di WIB, dikonversi ke instant UTC. */
function todayRangeWib(): { start: Date; end: Date; label: string } {
  const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth();
  const d = nowWib.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - WIB_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const label = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start, end, label };
}

async function main(): Promise<void> {
  const { start, end, label } = todayRangeWib();
  console.log(`[INFO] Mode   : ${EXECUTE ? 'EXECUTE (UBAH DATA)' : 'DRY-RUN (tidak mengubah data)'}`);
  console.log(`[INFO] Tanggal: ${label} WIB  (${start.toISOString()} -> ${end.toISOString()})`);

  // Actor audit: admin aktif tertua (audit_logs.actor_id NOT NULL)
  const [admin] = await db
    .select({ id: admins.id, fullName: admins.fullName })
    .from(admins)
    .where(and(eq(admins.isActive, true), sql`${admins.deletedAt} IS NULL`))
    .orderBy(asc(admins.createdAt))
    .limit(1);
  if (!admin) throw new Error('Tidak ada admin aktif untuk dicatat sebagai actor.');
  console.log(`[INFO] Actor  : ${admin.fullName} (${admin.id})`);

  const targets = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      paymentMethod: transactions.paymentMethod,
      grossAmount: transactions.grossAmount,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.status, 'COMPLETED'),
        gte(transactions.createdAt, start),
        lt(transactions.createdAt, end),
      ),
    )
    .limit(500); // FinOps guard

  console.log(`\n[FOUND] ${targets.length} transaksi COMPLETED hari ini:`);
  let total = 0;
  for (const t of targets) {
    total += Number(t.grossAmount);
    console.log(`  ${t.invoiceNumber} | ${t.paymentMethod} | Rp${Number(t.grossAmount).toLocaleString('id-ID')} | ${t.createdAt.toISOString()}`);
  }
  console.log(`  TOTAL: Rp${total.toLocaleString('id-ID')}`);

  if (targets.length === 0) {
    console.log('[INFO] Tidak ada yang perlu di-void.');
    return;
  }
  if (!EXECUTE) {
    console.log('\n[DRY-RUN] Selesai. Tambahkan --execute untuk benar-benar void.');
    return;
  }

  const now = new Date();
  let stockRestored = 0;

  await db.transaction(async (tx) => {
    for (const t of targets) {
      // Guard race condition: hanya void jika masih COMPLETED
      const updated = await tx
        .update(transactions)
        .set({
          status: 'VOID',
          voidReason: ALASAN,
          voidedByAdminId: admin.id,
          voidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(transactions.id, t.id), eq(transactions.status, 'COMPLETED')))
        .returning({ id: transactions.id });
      if (updated.length === 0) continue;

      const items = await tx
        .select({ productId: transactionItems.productId, qty: transactionItems.qty })
        .from(transactionItems)
        .where(eq(transactionItems.transactionId, t.id));

      for (const it of items) {
        // Increment atomik di level SQL (aman dari lost-update)
        await tx
          .update(products)
          .set({ stockQty: sql`${products.stockQty} + ${it.qty}`, updatedAt: now })
          .where(eq(products.id, it.productId));
        stockRestored += it.qty;
      }

      await tx.insert(auditLogs).values({
        tableName: 'transactions',
        recordId: t.id,
        action: 'UPDATE',
        oldValues: JSON.stringify({ status: 'COMPLETED' }),
        newValues: JSON.stringify({
          status: 'VOID',
          voidReason: ALASAN,
          voidedByAdminId: admin.id,
          voidedAt: now.toISOString(),
        }),
        actorType: 'ADMIN',
        actorId: admin.id,
      });
    }
  });

  console.log(`\n[OK] ${targets.length} transaksi di-void. Total unit stok dikembalikan: ${stockRestored}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('[ERROR]', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
