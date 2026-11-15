import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { suppliers } from '@/lib/db/schema';
import type { db as rootDb } from '@/lib/db/client';
import { AppError } from '@/lib/utils/helpers';

type DbExecutor = Pick<typeof rootDb, 'select' | 'insert'>;

/**
 * Resolves a normalized supplier UUID for 3NF warehouse tables.
 * - If supplierId is given, verifies the supplier exists (not soft-deleted).
 * - Otherwise if supplierName is non-empty, matches case-insensitively on active
 *   suppliers or creates a normalized master supplier record automatically.
 */
export async function resolveNormalizedSupplierId(
  executor: DbExecutor,
  options: {
    supplierId?: string | null;
    supplierName?: string | null;
    createdByAdminId?: string | null;
    autoNote?: string;
  },
): Promise<string | null> {
  if (options.supplierId) {
    const [existing] = await executor
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, options.supplierId), isNull(suppliers.deletedAt)))
      .limit(1);

    if (!existing) {
      throw new AppError('BAD_REQUEST', 'Supplier yang dipilih tidak ditemukan.', 400);
    }
    return existing.id;
  }

  const cleanName = options.supplierName?.trim();
  if (!cleanName) return null;

  const [matched] = await executor
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        sql`LOWER(btrim(${suppliers.name})) = ${cleanName.toLowerCase()}`,
        isNull(suppliers.deletedAt),
      ),
    )
    .orderBy(desc(suppliers.isActive), suppliers.createdAt)
    .limit(1);

  if (matched) return matched.id;

  const [created] = await executor
    .insert(suppliers)
    .values({
      name: cleanName,
      isActive: true,
      createdByAdminId: options.createdByAdminId ?? null,
      notes: options.autoNote ?? 'Terdaftar otomatis saat input penerimaan barang gudang',
    })
    .returning({ id: suppliers.id });

  return created.id;
}

