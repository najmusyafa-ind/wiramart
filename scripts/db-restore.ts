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

/**
 * Pengaman target (Fase 0.2).
 * Restore MENGHAPUS lalu mengisi ulang data. Skrip ini membaca .env.local yang secara
 * default menunjuk PRODUKSI, jadi target harus dikonfirmasi eksplisit:
 *   RESTORE_TARGET_REF=<project-ref-target>  harus sama persis dengan ref di DATABASE_URL.
 * Tanpa itu skrip berhenti SEBELUM menyentuh database. Kredensial tidak pernah dicetak.
 */
function extractProjectRef(databaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const user = decodeURIComponent(parsed.username);
  const dot = user.indexOf('.');
  if (dot > 0 && dot < user.length - 1) return user.slice(dot + 1); // pooler: postgres.<ref>
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(parsed.hostname); // koneksi langsung
  return direct?.[1] ?? null;
}

function assertRestoreTarget(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL kosong. Restore dibatalkan.');

  const actualRef = extractProjectRef(databaseUrl);
  if (!actualRef) {
    throw new Error('Tidak bisa menentukan project ref dari DATABASE_URL. Restore dibatalkan demi keamanan.');
  }

  const masked = `${actualRef.slice(0, 3)}***${actualRef.slice(-2)}`;
  process.stdout.write(`🎯 Target restore (project ref): ${masked}\n`);

  const declared = process.env.RESTORE_TARGET_REF?.trim();
  if (!declared) {
    throw new Error(
      'RESTORE_TARGET_REF belum diisi. Restore MENGHAPUS data pada target di atas. ' +
        'Isi RESTORE_TARGET_REF dengan project ref LENGKAP target yang dimaksud, lalu jalankan ulang. ' +
        '(Untuk staging: set DATABASE_URL dan RESTORE_TARGET_REF ke nilai staging di shell, bukan .env.local.)'
    );
  }
  if (declared !== actualRef) {
    throw new Error(
      'RESTORE_TARGET_REF tidak cocok dengan project ref pada DATABASE_URL. Restore dibatalkan: ' +
        'kemungkinan salah target.'
    );
  }
}

async function runCliRestore() {
  process.stdout.write('\n⚠️ [DEVOPS RESTORE] Memulai inisialisasi pemulihan database...\n');
  const startTime = Date.now();

  try {
    assertRestoreTarget();
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
