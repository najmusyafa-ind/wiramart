// =============================================================
// src/lib/services/operationalSettingsService.ts
// Single Source of Truth untuk pengaturan operasional Wiramart
// (ambang stok rendah, toleransi keterlambatan, dan margin global).
// =============================================================

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { qrisSettings } from '@/lib/db/schema';

export const OPERATIONAL_SETTINGS_ID = '00000000-0000-0000-0000-000000000002';

export const DEFAULT_OPERATIONAL_SETTINGS = {
  attendanceTolerance: 15,
  lowStockThreshold: 5,
  globalMarginPercentage: 20,
} as const;

export type OperationalSettings = {
  attendanceTolerance: number;
  lowStockThreshold: number;
  globalMarginPercentage: number;
};

/**
 * Mengambil pengaturan operasional toko dari singleton row `qris_settings`.
 * Aman dipanggil dari server routes/services; mengembalikan fallback baku
 * bila baris singleton belum dibuat atau koneksi gagal sesaat.
 */
export async function getOperationalSettings(): Promise<OperationalSettings> {
  try {
    const row = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, OPERATIONAL_SETTINGS_ID),
      columns: {
        attendanceTolerance: true,
        lowStockThreshold: true,
        globalMarginPercentage: true,
      },
    });

    if (!row) {
      return { ...DEFAULT_OPERATIONAL_SETTINGS };
    }

    const rawThreshold = Number(row.lowStockThreshold);
    const lowStockThreshold = Number.isFinite(rawThreshold)
      ? Math.max(0, Math.min(9999, Math.trunc(rawThreshold)))
      : DEFAULT_OPERATIONAL_SETTINGS.lowStockThreshold;

    const rawTolerance = Number(row.attendanceTolerance);
    const attendanceTolerance = Number.isFinite(rawTolerance)
      ? Math.max(0, Math.min(120, Math.trunc(rawTolerance)))
      : DEFAULT_OPERATIONAL_SETTINGS.attendanceTolerance;

    const rawMargin = Number(row.globalMarginPercentage);
    const globalMarginPercentage = Number.isFinite(rawMargin)
      ? Math.max(0, Math.min(500, rawMargin))
      : DEFAULT_OPERATIONAL_SETTINGS.globalMarginPercentage;

    return {
      attendanceTolerance,
      lowStockThreshold,
      globalMarginPercentage,
    };
  } catch (err) {
    console.warn('[operationalSettingsService] Gagal membaca pengaturan, pakai default:', err);
    return { ...DEFAULT_OPERATIONAL_SETTINGS };
  }
}

/** Mengambil ambang batas stok rendah aktif dari database (fallback: 5). */
export async function getLowStockThreshold(): Promise<number> {
  const settings = await getOperationalSettings();
  return settings.lowStockThreshold;
}

