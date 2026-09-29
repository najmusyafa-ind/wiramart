// =============================================================
// Smartkasir Perwira — DevOps CLI Database Backup Script
// Cara pakai: npm run db:backup  (atau npx tsx scripts/db-backup.ts)
// =============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Load environment variables dari .env.local terlebih dahulu SEBELUM client.ts di-load
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config(); // fallback ke .env standar

import type { BackupPayload } from '../src/lib/db/backup/backup.types';

async function runCliBackup() {
  process.stdout.write('\n📦 [DEVOPS BACKUP] Memulai proses ekstraksi snapshot database...\n');
  const startTime = Date.now();

  try {
    const { databaseBackupRepository } = await import(
      '../src/lib/db/backup/DatabaseBackupRepository'
    );
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
        createdByName: 'DevOps Automated CLI',
        createdByNidn: 'SYSTEM_CLI',
      },
      data: snapshot.data,
    };

    const backupsDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const targetFilePath = path.join(backupsDir, filename);
    const serializedJson = JSON.stringify(payload, null, 2);
    fs.writeFileSync(targetFilePath, serializedJson, 'utf8');

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeKb = (Buffer.byteLength(serializedJson, 'utf8') / 1024).toFixed(2);

    process.stdout.write('\n✅ [DEVOPS BACKUP BERHASIL]\n');
    process.stdout.write(`   File Target  : ${targetFilePath}\n`);
    process.stdout.write(`   Ukuran File  : ${sizeKb} KB\n`);
    process.stdout.write(`   Total Baris  : ${snapshot.totalRows} baris dari ${payload.metadata.tablesCount} tabel\n`);
    process.stdout.write(`   Checksum SHA : ${snapshot.checksum}\n`);
    process.stdout.write(`   Durasi       : ${durationSeconds} detik\n\n`);

    process.exit(0);
  } catch (error) {
    process.stderr.write(`\n❌ [DEVOPS BACKUP GAGAL]: ${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exit(1);
  }
}

void runCliBackup();
