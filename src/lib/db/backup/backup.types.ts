// =============================================================
// Smartkasir Perwira — Database Backup & Restore DTO & Types
// Strictly Typed & Zod Validated (Zero `any`)
// =============================================================

import { z } from 'zod';

/**
 * Urutan topologis 14 tabel database untuk import/insert data (Parent -> Child).
 * Mencegah error Foreign Key constraint violation saat proses restore.
 */
export const BACKUP_TABLES_INSERT_ORDER = [
  'admins',
  'employees',
  'categories',
  'products',
  'shifts',
  'shift_schedules',
  'shift_swap_requests',
  'attendances',
  'transactions',
  'transaction_items',
  'stock_adjustments',
  'qris_settings',
  'maintenance_settings',
  'audit_logs',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES_INSERT_ORDER)[number];

/**
 * Urutan terbalik (Child -> Parent) untuk membersihkan tabel saat mode REPLACE_ALL.
 * Menghindari penolakan delete akibat keterikatan Foreign Key.
 */
export const RESTORE_CLEANUP_ORDER = [
  'audit_logs',
  'stock_adjustments',
  'transaction_items',
  'transactions',
  'attendances',
  'shift_swap_requests',
  'shift_schedules',
  'shifts',
  'products',
  'categories',
  'employees',
  'qris_settings',
  'maintenance_settings',
  'admins',
] as const;

// ── Zod Schema: Metadata Snapshot Backup ─────────────────────
export const backupMetadataSchema = z.object({
  app: z.literal('smartkasir-perwira'),
  version: z.string().min(1),
  schemaVersion: z.string().min(1),
  timestamp: z.string().datetime(),
  checksum: z.string().length(64), // SHA-256 hash (64 hex characters)
  tablesCount: z.number().int().min(1).max(50),
  totalRows: z.number().int().nonnegative(),
  tableRowCounts: z.record(z.string(), z.number().int().nonnegative()),
  createdByName: z.string().min(1),
  createdByNidn: z.string().min(1),
});

export type BackupMetadata = z.infer<typeof backupMetadataSchema>;

// ── Zod Schema: Payload Lengkap File Backup ──────────────────
export const backupPayloadSchema = z.object({
  metadata: backupMetadataSchema,
  data: z.record(
    z.string(),
    z.array(z.record(z.string(), z.unknown()))
  ),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;

// ── Zod Schema: Permintaan Restore via API ───────────────────
export const restoreRequestSchema = z.object({
  payload: backupPayloadSchema,
  createSafetySnapshot: z.boolean().default(true),
  notes: z.string().max(255).optional(),
});

export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

// ── Tipe Hasil Eksekusi Restore (Audit Log & Response) ───────
export interface RestoreResultSummary {
  success: boolean;
  message: string;
  restoredTables: number;
  restoredRows: number;
  durationMs: number;
  tableDetails: Record<string, number>;
  backupTimestamp: string;
  executedAt: string;
  executedBy: {
    nidn: string;
    fullName: string;
  };
}

// ── Tipe Item Riwayat Backup ─────────────────────────────────
export interface BackupFileDescriptor {
  filename: string;
  timestamp: string;
  sizeBytes: number;
  totalRows: number;
  checksum: string;
}
