// =============================================================
// Smartkasir Perwira — DevOps CLI Database Restore Script
// Cara pakai: npm run db:restore [path-file-backup.json]
// Jika path file tidak diberikan, script otomatis memakai file backup terbaru di folder backups/
// =============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Load environment variables dari .env.local terlebih dahulu SEBELUM client.ts di-load
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config(); // fallback ke .env standar

import type { BackupPayload } from '../src/lib/db/backup/backup.types';

function getLatestBackupFile(backupsDir: string): string | null {
  if (!fs.existsSync(backupsDir)) return null;
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('backup-smartkasir-') && f.endsWith('.json'))
    .map((f) => path.join(backupsDir, f));

  if (files.length === 0) return null;

  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

async function runCliRestore() {
  process.stdout.write('\n⚠️ [DEVOPS RESTORE] Memulai inisialisasi pemulihan database...\n');
  const startTime = Date.now();

  try {
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const customFilePath = process.argv[2];
    const targetFilePath = customFilePath ? path.resolve(customFilePath) : getLatestBackupFile(backupsDir);

    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      throw new Error(
        `File backup tidak ditemukan! Pastikan file ada atau taruh file di folder: ${backupsDir}`
      );
    }

    process.stdout.write(`📂 Membaca berkas backup: ${targetFilePath}\n`);
    const fileContent = fs.readFileSync(targetFilePath, 'utf8');

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(fileContent);
    } catch {
      throw new Error('Berkas backup rusak atau bukan format JSON yang valid.');
    }

    // 1. Validasi integritas dan Checksum SHA-256
    const { databaseBackupService } = await import(
      '../src/lib/db/backup/DatabaseBackupService'
    );
    process.stdout.write('🔍 Memvalidasi struktur data dan Checksum SHA-256...\n');
    const validation = databaseBackupService.validateBackupPayload(rawJson);
    if (!validation.isValid) {
      throw new Error(`Validasi gagal: ${validation.error}`);
    }

    const payload = rawJson as BackupPayload;
    process.stdout.write(`   ✓ Checksum SHA-256 Valid: ${payload.metadata.checksum.slice(0, 16)}...\n`);
    process.stdout.write(`   ✓ Target Aplikasi       : ${payload.metadata.app}\n`);
    process.stdout.write(`   ✓ Total Baris Terdaftar : ${payload.metadata.totalRows} baris\n`);

    // 2. Eksekusi Restore Transaksional ACID
    process.stdout.write('\n⚡ Menjalankan Atomic ACID Transaction (Menghapus & Mengisi Ulang Data)...\n');
    const summary = await databaseBackupService.restoreBackup(payload, {
      id: '00000000-0000-0000-0000-000000000000',
      nidn: 'SYSTEM_CLI',
      fullName: 'DevOps Automated CLI',
    });

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    process.stdout.write('\n🎉 [DEVOPS RESTORE BERHASIL DILAKUKAN]\n');
    process.stdout.write(`   Pesan               : ${summary.message}\n`);
    process.stdout.write(`   Total Baris Dipulih : ${summary.restoredRows} baris\n`);
    process.stdout.write(`   Total Tabel         : ${summary.restoredTables} tabel\n`);
    process.stdout.write(`   Durasi Eksekusi     : ${durationSeconds} detik\n`);
    process.stdout.write(`   Waktu Asal Backup   : ${summary.backupTimestamp}\n\n`);

    process.exit(0);
  } catch (error) {
    process.stderr.write(`\n❌ [DEVOPS RESTORE GAGAL]: ${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exit(1);
  }
}

void runCliRestore();
