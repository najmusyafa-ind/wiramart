/**
 * scripts/backfill-attendance-shift-id.ts
 *
 * ══════════════════════════════════════════════════════════════
 * SAFE BACKFILL: attendance.shift_id yang masih NULL
 * ══════════════════════════════════════════════════════════════
 *
 * AMAN karena:
 *   - HANYA mengisi FK yang masih NULL (tidak overwrite yang sudah ada)
 *   - TIDAK mengubah nilai moneter apapun
 *   - Memakai logika 5-tier identik dengan RekapShift API
 *   - Dry-run mode default → jalankan dengan --apply untuk eksekusi
 *
 * CARA PAKAI:
 *   npx ts-node -e "require('./scripts/backfill-attendance-shift-id.ts')"
 *   → Default: DRY RUN (preview berapa yang akan diupdate)
 *
 *   npx ts-node -e "require('./scripts/backfill-attendance-shift-id.ts')" -- --apply
 *   → APPLY: Eksekusi update ke database
 *
 * ══════════════════════════════════════════════════════════════
 */

import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL tidak ada di .env.local');

const sql = postgres(DATABASE_URL, { ssl: 'require' });

const isDryRun = !process.argv.includes('--apply');

type AttRow = {
  id: string;
  employee_id: string;
  attendance_date: string;
  clock_in_actual: Date | null;
  schedule_slot_start: string | null;
};

type ShiftRow = {
  id: string;
  employee_id: string;
  clock_in: Date;
  clock_out: Date | null;
};

/** Konversi timestamp ke tanggal WIB (YYYY-MM-DD) */
function toWibDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

/** Jam WIB dari timestamp (0-23) */
function wibHour(d: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: 'numeric',
      hour12: false,
    }).format(d),
    10,
  );
}

async function main() {
  console.log('═'.repeat(60));
  console.log('BACKFILL attendance.shift_id');
  console.log(isDryRun ? '▶ MODE: DRY RUN (tidak ada perubahan DB)' : '▶ MODE: APPLY (akan update DB)');
  console.log('═'.repeat(60));

  // 1. Ambil semua attendance yang shift_id IS NULL dan statusnya hadir
  const nullAtts = await sql<AttRow[]>`
    SELECT
      a.id,
      a.employee_id,
      a.attendance_date::text,
      a.clock_in_actual,
      ss.slot_start AS schedule_slot_start
    FROM attendances a
    LEFT JOIN shift_schedules ss ON ss.id = a.schedule_id
    WHERE a.shift_id IS NULL
      AND a.status IN ('HADIR', 'TELAT', 'PENGGANTI')
    ORDER BY a.attendance_date DESC, a.clock_in_actual ASC
  `;

  console.log(`\nTotal attendance NULL shift_id: ${nullAtts.length}`);

  if (nullAtts.length === 0) {
    console.log('✅ Tidak ada yang perlu dibackfill. Semua attendance sudah terhubung ke shift.');
    await sql.end();
    return;
  }

  // 2. Ambil semua tanggal unik dari attendance yang perlu difix
  const dates = [...new Set(nullAtts.map((a) => a.attendance_date))];
  console.log(`Tanggal yang akan diproses: ${dates.length}`);

  // 3. Ambil semua shifts yang berkaitan dengan tanggal-tanggal tersebut
  // Karena shift WIB jam 07:00 = UTC jam 00:00, kita ambil range +/- 1 hari untuk safety
  const earliestDate = dates.sort()[0];
  const latestDate = dates.sort().slice(-1)[0];

  const shiftRows = await sql<ShiftRow[]>`
    SELECT id, employee_id, clock_in, clock_out
    FROM shifts
    WHERE clock_in >= (${earliestDate}::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Jakarta'
      AND clock_in <  (${latestDate}::date + INTERVAL '2 days') AT TIME ZONE 'Asia/Jakarta'
    ORDER BY clock_in ASC
  `;

  console.log(`Total shifts dalam rentang: ${shiftRows.length}`);

  // 4. Index shifts per tanggal WIB
  const shiftsByDate = new Map<string, ShiftRow[]>();
  for (const s of shiftRows) {
    const d = toWibDate(s.clock_in);
    const list = shiftsByDate.get(d) ?? [];
    list.push(s);
    shiftsByDate.set(d, list);
  }

  // 5. Matching logic (5 Tier — identik dengan RekapShift API)
  let matched = 0;
  let unmatched = 0;
  const updates: Array<{ attendanceId: string; shiftId: string; reason: string }> = [];

  for (const att of nullAtts) {
    const candidates = shiftsByDate.get(att.attendance_date) ?? [];
    if (candidates.length === 0) {
      console.warn(`  ⚠ ${att.id} (${att.attendance_date}) — Tidak ada shift di tanggal ini`);
      unmatched++;
      continue;
    }

    let matchedShift: ShiftRow | undefined;
    let matchTier = '';

    // Tier 2: Employee owns the shift
    const tier2 = candidates.find((s) => s.employee_id === att.employee_id);
    if (tier2) {
      matchedShift = tier2;
      matchTier = 'Tier2:employee_owns';
    }

    // Tier 3: clock_in_actual overlaps with shift window (±30 min)
    if (!matchedShift && att.clock_in_actual) {
      const attMs = new Date(att.clock_in_actual).getTime();
      const tier3 = candidates.find((s) => {
        const sIn  = new Date(s.clock_in).getTime();
        const sOut = s.clock_out
          ? new Date(s.clock_out).getTime()
          : sIn + 4.5 * 3600 * 1000;
        return attMs >= sIn - 30 * 60 * 1000 && attMs <= sOut + 30 * 60 * 1000;
      });
      if (tier3) {
        matchedShift = tier3;
        matchTier = 'Tier3:clockin_overlap';
      }
    }

    // Tier 4: Schedule slot heuristic (Pagi < 11, Siang >= 11)
    if (!matchedShift && att.schedule_slot_start) {
      const slotH = parseInt(att.schedule_slot_start.split(':')[0] ?? '8', 10);
      const isAfternoon = slotH >= 11;
      const tier4 = candidates.find((s) => {
        const h = wibHour(new Date(s.clock_in));
        return isAfternoon ? h >= 11 : h < 11;
      });
      if (tier4) {
        matchedShift = tier4;
        matchTier = 'Tier4:slot_heuristic';
      }
    }

    // Tier 5: Single candidate fallback
    if (!matchedShift && candidates.length === 1) {
      matchedShift = candidates[0];
      matchTier = 'Tier5:single_fallback';
    }

    if (matchedShift) {
      updates.push({
        attendanceId: att.id,
        shiftId: matchedShift.id,
        reason: matchTier,
      });
      matched++;
    } else {
      console.warn(`  ⚠ ${att.id} (${att.attendance_date}) — Tidak bisa dicocokkan ke shift manapun [${candidates.length} kandidat]`);
      unmatched++;
    }
  }

  console.log(`\n📊 Hasil Matching:`);
  console.log(`   ✅ Berhasil dipetakan : ${matched}`);
  console.log(`   ❌ Tidak bisa dipetakan: ${unmatched}`);

  // Tampilkan preview
  const tierCounts = new Map<string, number>();
  for (const u of updates) {
    tierCounts.set(u.reason, (tierCounts.get(u.reason) ?? 0) + 1);
  }
  console.log('\nDistribusi tier matching:');
  for (const [tier, count] of tierCounts) {
    console.log(`   ${tier}: ${count}x`);
  }

  if (isDryRun) {
    console.log('\n─'.repeat(60));
    console.log('DRY RUN — Tidak ada perubahan. Jalankan dengan --apply untuk eksekusi.');
    console.log('Contoh: npx tsx scripts/backfill-attendance-shift-id.ts --apply');
    console.log('─'.repeat(60));
  } else {
    // APPLY: Update secara batch
    console.log(`\n🔄 Mengeksekusi ${updates.length} UPDATE...`);

    let successCount = 0;
    for (const upd of updates) {
      await sql`
        UPDATE attendances
        SET shift_id = ${upd.shiftId}, updated_at = NOW()
        WHERE id = ${upd.attendanceId}
          AND shift_id IS NULL
      `;
      successCount++;
    }

    console.log(`✅ Berhasil diupdate: ${successCount} baris`);
    console.log('\nRekap per mahasiswa yang akan terdampak:');

    // Verifikasi setelah apply
    const afterCount = await sql`
      SELECT COUNT(*)::int AS count FROM attendances
      WHERE shift_id IS NULL AND status IN ('HADIR', 'TELAT', 'PENGGANTI')
    `;
    console.log(`   Sisa attendance NULL setelah backfill: ${afterCount[0]?.count ?? '?'}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
