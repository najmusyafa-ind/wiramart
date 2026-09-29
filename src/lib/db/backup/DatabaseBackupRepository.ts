// =============================================================
// Smartkasir Perwira — Database Backup & Restore Repository
// Layer: Repository (Isolasi Database & ACID Transaction Engine)
// =============================================================

import { createHash } from 'node:crypto';
import type { Table } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  BACKUP_TABLES_INSERT_ORDER,
  RESTORE_CLEANUP_ORDER,
  type BackupTableName,
  type BackupPayload,
  type RestoreResultSummary,
} from './backup.types';

// Pemetaan nama string tabel ke Drizzle Schema Table Object
const TABLE_SCHEMA_MAP: Record<BackupTableName, Table> = {
  admins: schema.admins,
  employees: schema.employees,
  categories: schema.categories,
  products: schema.products,
  shifts: schema.shifts,
  shift_schedules: schema.shiftSchedules,
  shift_swap_requests: schema.shiftSwapRequests,
  attendances: schema.attendances,
  transactions: schema.transactions,
  transaction_items: schema.transactionItems,
  stock_adjustments: schema.stockAdjustments,
  qris_settings: schema.qrisSettings,
  maintenance_settings: schema.maintenanceSettings,
  audit_logs: schema.auditLogs,
};

/**
 * Utility untuk membagi array menjadi batch berukuran kecil.
 * Mencegah batasan batas parameter SQL PostgreSQL (max 65,535 parameter per query).
 */
function chunkArray<T>(items: T[], size = 200): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Menghitung checksum SHA-256 secara deterministik dari payload data.
 * Kunci objek diurutkan secara leksikografis untuk memastikan hash identik di platform apa pun.
 */
export function calculateDataChecksum(data: Record<string, unknown>): string {
  const sortedKeys = Object.keys(data).sort();
  const canonicalObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonicalObj[key] = data[key];
  }
  const serialized = JSON.stringify(canonicalObj);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

export class DatabaseBackupRepository {
  /**
   * Mengambil snapshot seluruh data dari 14 tabel database dalam urutan topologis.
   */
  public async extractFullDatabaseSnapshot(): Promise<{
    data: Record<string, Record<string, unknown>[]>;
    tableRowCounts: Record<string, number>;
    totalRows: number;
    checksum: string;
  }> {
    const rawData: Record<string, Record<string, unknown>[]> = {};
    const tableRowCounts: Record<string, number> = {};
    let totalRows = 0;

    for (const tableName of BACKUP_TABLES_INSERT_ORDER) {
      const tableObj = TABLE_SCHEMA_MAP[tableName];
      // Ambil seluruh baris tabel secara terurut
      const rows = (await db.select().from(tableObj)) as unknown as Record<string, unknown>[];
      rawData[tableName] = rows;
      tableRowCounts[tableName] = rows.length;
      totalRows += rows.length;
    }

    const checksum = calculateDataChecksum(rawData);

    return {
      data: rawData,
      tableRowCounts,
      totalRows,
      checksum,
    };
  }

  /**
   * Menjalankan proses restore data menggunakan transaksi ACID terisolasi.
   * Jika terjadi satu saja kegagalan atau ketidakcocokan constraint,
   * transaksi langsung di-ROLLBACK sehingga database kembali utuh ke kondisi semula.
   */
  public async restoreFullDatabaseSnapshot(
    payload: BackupPayload,
    adminActor: { nidn: string; fullName: string }
  ): Promise<RestoreResultSummary> {
    const startTime = Date.now();
    const restoredDetails: Record<string, number> = {};
    let totalRestoredRows = 0;

    // 1. Verifikasi integritas checksum SHA-256 sebelum menyentuh database
    const calculatedChecksum = calculateDataChecksum(payload.data);
    if (calculatedChecksum !== payload.metadata.checksum) {
      throw new Error(
        `[SECURITY_VIOLATION] Checksum file backup tidak cocok! Data mungkin telah rusak atau dimanipulasi. Diharapkan: ${payload.metadata.checksum}, Dihitung: ${calculatedChecksum}`
      );
    }

    // 2. Eksekusi Atomic Transaction
    await db.transaction(async (tx) => {
      // Step A: Bersihkan data lama dengan urutan Child -> Parent (RESTORE_CLEANUP_ORDER)
      for (const tableName of RESTORE_CLEANUP_ORDER) {
        const tableObj = TABLE_SCHEMA_MAP[tableName];
        await tx.delete(tableObj);
      }

      // Step B: Masukkan data baru dengan urutan Parent -> Child (BACKUP_TABLES_INSERT_ORDER)
      for (const tableName of BACKUP_TABLES_INSERT_ORDER) {
        const rows = payload.data[tableName];
        if (!rows || rows.length === 0) {
          restoredDetails[tableName] = 0;
          continue;
        }

        const tableObj = TABLE_SCHEMA_MAP[tableName];
        const batches = chunkArray(rows, 150);

        for (const batch of batches) {
          // Type casting safe: batch data sudah diverifikasi oleh Zod schema sebelumnya
          await tx.insert(tableObj).values(batch as never);
        }

        restoredDetails[tableName] = rows.length;
        totalRestoredRows += rows.length;
      }
    });

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      message: `Database berhasil di-restore dengan sempurna (${totalRestoredRows} total baris dipulihkan).`,
      restoredTables: Object.keys(restoredDetails).length,
      restoredRows: totalRestoredRows,
      durationMs,
      tableDetails: restoredDetails,
      backupTimestamp: payload.metadata.timestamp,
      executedAt: new Date().toISOString(),
      executedBy: adminActor,
    };
  }
}

export const databaseBackupRepository = new DatabaseBackupRepository();
