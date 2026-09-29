// =============================================================
// Smartkasir Perwira — Database Backup & Restore Service
// Layer: Service (Domain Logic, Safety Validations, & Audit Trail)
// =============================================================

import {
  backupPayloadSchema,
  type BackupPayload,
  type RestoreResultSummary,
} from './backup.types';
import {
  databaseBackupRepository,
  calculateDataChecksum,
} from './DatabaseBackupRepository';
import { db } from '@/lib/db/client';
import { auditLogs } from '@/lib/db/schema';

export interface AdminActor {
  id: string;
  nidn: string;
  fullName: string;
}

export interface BackupPackageResult {
  filename: string;
  payload: BackupPayload;
  summary: {
    totalRows: number;
    tablesCount: number;
    checksum: string;
    timestamp: string;
  };
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  metadata?: BackupPayload['metadata'];
}

export class DatabaseBackupService {
  /**
   * Menghasilkan file backup utuh (snapshot 14 tabel) siap unduh.
   */
  public async createBackup(actor: AdminActor): Promise<BackupPackageResult> {
    const snapshot = await databaseBackupRepository.extractFullDatabaseSnapshot();
    const timestamp = new Date().toISOString();
    const dateFormatted = timestamp.replace(/[:.]/g, '-');
    const filename = `backup-smartkasir-${dateFormatted}.json`;

    const payload: BackupPayload = {
      metadata: {
        app: 'smartkasir-perwira',
        version: '1.2.0',
        schemaVersion: '1.1',
        timestamp,
        checksum: snapshot.checksum,
        tablesCount: Object.keys(snapshot.data).length,
        totalRows: snapshot.totalRows,
        tableRowCounts: snapshot.tableRowCounts,
        createdByName: actor.fullName,
        createdByNidn: actor.nidn,
      },
      data: snapshot.data,
    };

    return {
      filename,
      payload,
      summary: {
        totalRows: snapshot.totalRows,
        tablesCount: payload.metadata.tablesCount,
        checksum: snapshot.checksum,
        timestamp,
      },
    };
  }

  /**
   * Memvalidasi file JSON backup sebelum diproses oleh proses restore.
   */
  public validateBackupPayload(rawJson: unknown): ValidationResult {
    const parseResult = backupPayloadSchema.safeParse(rawJson);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message ?? 'Format file backup tidak valid';
      return {
        isValid: false,
        error: `[VALIDATION_ERROR] ${issue}`,
      };
    }

    const payload = parseResult.data;

    // Verifikasi identitas aplikasi
    if (payload.metadata.app !== 'smartkasir-perwira') {
      return {
        isValid: false,
        error: `[INVALID_APP] File backup ini bukan untuk aplikasi Smartkasir Perwira (terdeteksi: ${payload.metadata.app})`,
      };
    }

    // Verifikasi checksum SHA-256
    const calculated = calculateDataChecksum(payload.data);
    if (calculated !== payload.metadata.checksum) {
      return {
        isValid: false,
        error: '[CHECKSUM_MISMATCH] Integritas data rusak atau telah dimodifikasi (Checksum SHA-256 tidak cocok).',
      };
    }

    return {
      isValid: true,
      metadata: payload.metadata,
    };
  }

  /**
   * Menjalankan prosedur restore lengkap dengan ACID transaction.
   */
  public async restoreBackup(
    payload: BackupPayload,
    actor: AdminActor
  ): Promise<RestoreResultSummary> {
    // 1. Validasi struktur dan integritas
    const validation = this.validateBackupPayload(payload);
    if (!validation.isValid) {
      throw new Error(validation.error ?? 'File backup tidak valid');
    }

    // 2. Eksekusi Restore Transaksional melalui Repository
    const result = await databaseBackupRepository.restoreFullDatabaseSnapshot(payload, {
      nidn: actor.nidn,
      fullName: actor.fullName,
    });

    // 3. Catat jejak audit khusus untuk peristiwa restore ke tabel audit_logs
    try {
      await db.insert(auditLogs).values({
        tableName: 'database',
        recordId: actor.id,
        action: 'UPDATE',
        oldValues: JSON.stringify({ event: 'PRE_RESTORE_WIPED' }),
        newValues: JSON.stringify({
          event: 'RESTORE_SUCCESSFUL',
          backupTimestamp: payload.metadata.timestamp,
          restoredRows: result.restoredRows,
          checksum: payload.metadata.checksum,
        }),
        actorType: 'ADMIN',
        actorId: actor.id,
      });
    } catch {
      // Audit log post-restore failure should not abort success of restored database
    }

    return result;
  }
}

export const databaseBackupService = new DatabaseBackupService();
