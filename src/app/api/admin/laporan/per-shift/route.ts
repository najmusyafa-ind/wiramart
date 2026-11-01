// =============================================================
// GET /api/admin/laporan/per-shift
// Laporan keuangan per shift (Pagi 07:00-11:30 | Siang 11:30-15:00)
// + Bagi hasil per mahasiswa per shift.
//
// Formula laba: SUM(subtotal_sell - subtotal_cost) dari transaction_items
// (audit-proof, tidak pakai transactions.gross_profit yang berpotensi inkonsisten)
//
// Auth: sk_admin + adminRole = MANAGER
// Query params: dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD
//              period=daily|weekly|monthly|semi_annual
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  transactions,
  transactionItems,
  shifts,
  employees,
  attendances,
  shiftSchedules,
} from '@/lib/db/schema';
import { and, asc, eq, gte, lte, lt, inArray, isNull, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  resolveReportRange,
  getFinancialReport,
  allocateProportional,
  KETUA_UMKM_NIM,
  KETUA_UMKM_CANONICAL_ID,
  KETUA_UMKM_DUPLICATE_ID,
  PERSEN_TUNJANGAN_KETUA,
  extractRoleFromNotes,
  getSessionDurationWeight,
  computePersonnelWeight,
  type PeriodKey,
} from '@/lib/finance/report';

export const runtime = 'nodejs';

const PERIODS: readonly PeriodKey[] = ['daily', 'weekly', 'monthly', 'semi_annual'];

export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Laporan per-shift hanya untuk Manager (Dosen).', 403);
  }

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const period = PERIODS.find((p) => p === rawPeriod) ?? null;
  const monthParam = sp.get('month'); // 'YYYY-MM'
  const dateParam = sp.get('date');   // 'YYYY-MM-DD'
  let dateFrom = sp.get('dateFrom') || dateParam;
  let dateTo = sp.get('dateTo') || dateParam;

  if (monthParam) {
    const [yStr, mStr] = monthParam.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
      dateFrom = `${monthParam}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      dateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  let range;
  try {
    range = resolveReportRange({
      period: period || (monthParam ? 'monthly' : (!dateFrom ? 'monthly' : null)),
      dateFrom,
      dateTo,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Rentang tanggal tidak valid';
    return apiError(msg, 400);
  }

  try {
    const financial = await getFinancialReport(range);

    // ─────────────────────────────────────────────────────────────
    // Query daftar bulan yang tersedia (untuk navigasi filter di UI)
    // ─────────────────────────────────────────────────────────────
    const availableMonthsRaw = await db
      .select({
        month: sql<string>`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')`,
      })
      .from(shifts)
      .groupBy(sql`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') DESC`);
    const availableMonths = availableMonthsRaw.map((m) => m.month).filter(Boolean);

    // ─────────────────────────────────────────────────────────────
    // 0b. Ambil Master Jadwal Shift (Anggota Tetap per Hari & Sesi)
    // ─────────────────────────────────────────────────────────────
    const DAY_ENUM_TO_HARI: Record<string, string> = {
      SENIN: 'Senin',
      SELASA: 'Selasa',
      RABU: 'Rabu',
      KAMIS: 'Kamis',
      JUMAT: 'Jumat',
      SABTU: 'Sabtu',
      MINGGU: 'Minggu',
    };

    const scheduleRows = await db
      .select({
        dayOfWeek:    shiftSchedules.dayOfWeek,
        slotStart:    shiftSchedules.slotStart,
        orderInSlot:  shiftSchedules.orderInSlot,
        employeeId:   employees.id,
        fullName:     employees.fullName,
        nim:          employees.nim,
        programStudi: employees.programStudi,
        jabatan:      employees.jabatan,
      })
      .from(shiftSchedules)
      .innerJoin(
        employees,
        and(
          eq(shiftSchedules.employeeId, employees.id),
          isNull(employees.deletedAt),
          eq(employees.isActive, true),
        ),
      )
      .where(eq(shiftSchedules.isActive, true))
      .orderBy(asc(shiftSchedules.dayOfWeek), asc(shiftSchedules.slotStart), asc(shiftSchedules.orderInSlot));

    const scheduleTeams: Record<
      string,
      { employeeId: string; fullName: string; nim: string; programStudi: string; jabatan: string }[]
    > = {};

    for (const sr of scheduleRows) {
      const hari = DAY_ENUM_TO_HARI[sr.dayOfWeek] ?? sr.dayOfWeek;
      const slotH = parseInt(sr.slotStart.split(':')[0] ?? '7', 10);
      const sesi = slotH >= 11 ? 'Siang' : 'Pagi';
      const key = `${hari}-${sesi}`;
      const list = scheduleTeams[key] ?? [];
      const empId =
        sr.employeeId === KETUA_UMKM_DUPLICATE_ID || sr.nim === KETUA_UMKM_NIM
          ? KETUA_UMKM_CANONICAL_ID
          : sr.employeeId;
      if (!list.some((x) => x.employeeId === empId)) {
        list.push({
          employeeId: empId,
          fullName: empId === KETUA_UMKM_CANONICAL_ID ? 'Gita Aprilianingrum' : sr.fullName,
          nim: empId === KETUA_UMKM_CANONICAL_ID ? KETUA_UMKM_NIM : sr.nim,
          programStudi: sr.programStudi,
          jabatan: empId === KETUA_UMKM_CANONICAL_ID ? 'Ketua UMKM / Admin Shift' : sr.jabatan,
        });
      }
      scheduleTeams[key] = list;
    }

    // ─────────────────────────────────────────────────────────────
    // 1. Ambil semua shifts dalam rentang (TANPA filter nama testing)
    //    Filter testing hanya untuk tampilan laporan, bukan data shift.
    //    Kasir "testing" tetap punya laba dari shift → perlu diinclude.
    // ─────────────────────────────────────────────────────────────
    const shiftRows = await db
      .select({
        id: shifts.id,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        employeeId: shifts.employeeId,
        kasirName: employees.fullName,
        kasirNim: employees.nim,
        kasirProdi: employees.programStudi,
        kasirJabatan: employees.jabatan,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(
        and(
          gte(shifts.clockIn, range.start),
          lt(shifts.clockIn, range.endExclusive),
        ),
      )
      .orderBy(shifts.clockIn);

    const fs = financial.summary;
    const labaOperasionalBersih = Math.max(0, fs.labaKotor - fs.biayaOperasional);
    const poolHakMahasiswa = fs.alokasiGajiKaryawan;

    if (shiftRows.length === 0) {
      return apiOk({
        range: { startDate: range.startDate, endDate: range.endDate, label: range.label },
        shifts: [],
        summaryPerEmployee: [],
        scheduleTeams,
        availableMonths,
        grandTotal: {
          omzet: fs.omzet,
          labaKotor: fs.labaKotor,
          biayaOperasional: fs.biayaOperasional,
          labaOperasionalBersih,
          poolGaji: poolHakMahasiswa,
          tunjanganKetua: 0,
          poolShiftMahasiswa: poolHakMahasiswa,
          txCount: fs.txCount,
          totalDistributed: 0,
          sisaPool: poolHakMahasiswa,
          labaBersihToko: fs.labaBersih,
        },
      });
    }

    // Normalisasi jika masih ada referensi ke duplikat akun Ketua UMKM
    for (const s of shiftRows) {
      if (s.employeeId === KETUA_UMKM_DUPLICATE_ID || s.kasirNim === KETUA_UMKM_NIM) {
        s.employeeId = KETUA_UMKM_CANONICAL_ID;
        s.kasirName = 'Gita Aprilianingrum';
        s.kasirNim = KETUA_UMKM_NIM;
        s.kasirProdi = 'Akuntansi';
        s.kasirJabatan = 'Ketua UMKM / Admin Shift';
      }
    }

    const shiftIds = shiftRows.map((s) => s.id);

    // ─────────────────────────────────────────────────────────────
    // 2. Hitung laba kotor per shift dari SNAPSHOT item (audit-proof)
    //    Formula: SUM(subtotal_sell - subtotal_cost) di mana cost > 0
    //    Produk HPP=0 (dummy/selisih laci) TIDAK dihitung sebagai laba
    // ─────────────────────────────────────────────────────────────
    const shiftFinancials = await db
      .select({
        shiftId: transactions.shiftId,
        omzet: sql<string>`ROUND(COALESCE(SUM(${transactionItems.subtotalSell}), 0))`,
        labaKotor: sql<string>`ROUND(COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalSell} - ${transactionItems.subtotalCost} ELSE 0 END), 0))`,
        txCount: sql<number>`COUNT(DISTINCT ${transactions.id})::int`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          inArray(transactions.shiftId, shiftIds),
        ),
      )
      .groupBy(transactions.shiftId);

    const finByShift = new Map<string, { omzet: number; labaKotor: number; txCount: number }>();
    for (const f of shiftFinancials) {
      if (f.shiftId) {
        finByShift.set(f.shiftId, {
          omzet: parseFloat(f.omzet || '0'),
          labaKotor: parseFloat(f.labaKotor || '0'),
          txCount: f.txCount,
        });
      }
    }

    const wibDateOf = (d: Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);

    const sesiByShift = new Map<string, 'Pagi' | 'Siang'>();
    const shiftIdsByDate = new Map<string, string[]>();
    for (const s of shiftRows) {
      const key = wibDateOf(s.clockIn);
      const list = shiftIdsByDate.get(key) ?? [];
      list.push(s.id);
      shiftIdsByDate.set(key, list);

      const wibHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false,
        }).format(s.clockIn),
        10
      );
      sesiByShift.set(s.id, wibHour >= 11 ? 'Siang' : 'Pagi');
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Ambil absensi yang hadir pada rentang ini
    // ─────────────────────────────────────────────────────────────
    const attRows = await db.query.attendances.findMany({
      where: and(
        gte(attendances.attendanceDate, range.startDate),
        lte(attendances.attendanceDate, range.endDate),
        inArray(attendances.status, ['HADIR', 'TELAT', 'PENGGANTI']),
      ),
      with: {
        employee: {
          columns: { id: true, fullName: true, nim: true, programStudi: true, jabatan: true },
        },
        schedule: {
          columns: { slotStart: true, slotEnd: true, dayOfWeek: true },
        },
      },
    });

    for (const att of attRows) {
      if (att.employeeId === KETUA_UMKM_DUPLICATE_ID || att.employee.nim === KETUA_UMKM_NIM) {
        att.employeeId = KETUA_UMKM_CANONICAL_ID;
        att.employee.id = KETUA_UMKM_CANONICAL_ID;
        att.employee.fullName = 'Gita Aprilianingrum';
        att.employee.nim = KETUA_UMKM_NIM;
        att.employee.programStudi = 'Akuntansi';
        att.employee.jabatan = 'Ketua UMKM / Admin Shift';
      }
    }

    // Index absensi per shift (tier 1: shiftId FK langsung)
    const attByShift = new Map<string, typeof attRows>();
    const attOrphan: typeof attRows = [];

    for (const att of attRows) {
      if (att.shiftId) {
        const list = attByShift.get(att.shiftId) ?? [];
        list.push(att);
        attByShift.set(att.shiftId, list);
      } else {
        attOrphan.push(att);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Matching absensi orphan ke shift via heuristik (Tier 2-5)
    // ─────────────────────────────────────────────────────────────
    for (const att of attOrphan) {
      const attDate = att.attendanceDate;
      const candidates = shiftRows.filter((s) => wibDateOf(s.clockIn) === attDate);
      if (candidates.length === 0) continue;

      let matched: typeof candidates[0] | undefined;

      // Tier 2: Employee owns the shift
      if (!matched) {
        matched = candidates.find((s) => s.employeeId === att.employeeId);
      }

      // Tier 3: ClockInActual overlap
      if (!matched && att.clockInActual) {
        const attMs = new Date(att.clockInActual).getTime();
        matched = candidates.find((s) => {
          const sIn = s.clockIn.getTime();
          const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
          return attMs >= sIn - 30 * 60 * 1000 && attMs <= sOut + 30 * 60 * 1000;
        });
      }

      // Tier 4: Schedule slot heuristic (Pagi < 11:00, Siang >= 11:00)
      if (!matched && att.schedule?.slotStart) {
        const slotH = parseInt(att.schedule.slotStart.split(':')[0] ?? '8', 10);
        const isAfternoon = slotH >= 11;
        matched = candidates.find((s) => {
          const sHour = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false,
          }).format(s.clockIn);
          return isAfternoon ? parseInt(sHour, 10) >= 11 : parseInt(sHour, 10) < 11;
        });
      }

      // Tier 5: single shift fallback
      if (!matched && candidates.length === 1) {
        matched = candidates[0];
      }

      if (matched) {
        const list = attByShift.get(matched.id) ?? [];
        list.push(att);
        attByShift.set(matched.id, list);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4b. Integrasi Kasir Shift & Deduplikasi per Shift
    // ─────────────────────────────────────────────────────────────
    for (const s of shiftRows) {
      const rawList = attByShift.get(s.id) ?? [];
      const deduped: typeof attRows = [];
      const seenEmp = new Set<string>();
      for (const att of rawList) {
        if (!seenEmp.has(att.employee.id)) {
          seenEmp.add(att.employee.id);
          deduped.push(att);
        }
      }

      const isTesting = s.kasirName.toLowerCase().includes('testing') || s.kasirNim === '02405013';
      if (!isTesting && !seenEmp.has(s.employeeId)) {
        deduped.push({
          id: `shift-kasir-${s.id}`,
          employeeId: s.employeeId,
          scheduleId: '',
          shiftId: s.id,
          attendanceDate: wibDateOf(s.clockIn),
          clockInActual: s.clockIn,
          clockOutActual: s.clockOut,
          status: 'HADIR',
          lateMinutes: 0,
          notes: 'Peran: Kasir | Auto-integrated shift cashier',
          recordedByAdminId: null,
          fromSwapRequestId: null,
          createdAt: s.clockIn,
          updatedAt: s.clockIn,
          employee: {
            id: s.employeeId,
            fullName: s.kasirName,
            nim: s.kasirNim,
            programStudi: s.kasirProdi,
            jabatan: s.kasirJabatan || 'Kasir',
          },
          schedule: {
            slotStart: sesiByShift.get(s.id) === 'Siang' ? '11:30' : '07:00',
            slotEnd: sesiByShift.get(s.id) === 'Siang' ? '15:00' : '11:30',
            dayOfWeek: 'SENIN',
          },
        });
      }
      attByShift.set(s.id, deduped);
    }

    // ─────────────────────────────────────────────────────────────
    // 4c. Alokasi Pool Shift (Opsi A — 100% Pool Mahasiswa ke Shift)
    //     Pool harian dibagi ke shift dengan bobot Laba Kotor × Bobot Durasi Sesi
    //     (Pagi 1.25x vs Siang 1.00x).
    // ─────────────────────────────────────────────────────────────
    const poolShiftMahasiswa = poolHakMahasiswa;
    const dayPool = new Map<string, number>();
    for (const d of financial.daily) {
      dayPool.set(d.date, d.alokasiGajiKaryawan);
    }

    const poolByShift = new Map<string, number>();
    for (const [date, ids] of shiftIdsByDate) {
      const hasAnyAttendee = ids.some((id) => (attByShift.get(id)?.length ?? 0) > 0);
      const weights = ids.map((id) => {
        if (hasAnyAttendee && (attByShift.get(id)?.length ?? 0) === 0) return 0;
        const lk = Math.max(0, finByShift.get(id)?.labaKotor ?? 0);
        const durW = getSessionDurationWeight(sesiByShift.get(id) ?? 'Pagi');
        return lk * durW;
      });
      const shares = allocateProportional(dayPool.get(date) ?? 0, weights);
      ids.forEach((id, i) => poolByShift.set(id, shares[i] ?? 0));
    }

    // ─────────────────────────────────────────────────────────────
    // 5. Bangun response per shift + akumulasi per karyawan
    // ─────────────────────────────────────────────────────────────
    type AttendeeRow = {
      employeeId: string;
      fullName: string;
      nim: string;
      programStudi: string;
      jabatan: string;
      status: string;
      lateMinutes: number;
      penaltyPercent: number;
      roleWeight: number;
      sessionWeight: number;
      totalWeight: number;
      nominalBagiHasil: number;
    };

    type ShiftRow = {
      shiftId: string;
      tanggal: string;       // 'YYYY-MM-DD' WIB
      hari: string;          // 'Senin', 'Selasa', …
      sesi: 'Pagi' | 'Siang';
      slotLabel: string;     // '07:00-11:30' | '11:30-15:00'
      clockIn: string;
      clockOut: string | null;
      kasirName: string;
      kasirNim: string;
      txCount: number;
      omzet: number;
      labaKotor: number;
      poolGaji: number;
      personnelCount: number;
      nominalPerOrang: number;
      personnel: AttendeeRow[];
    };

    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const empAgg = new Map<string, {
      employeeId: string;
      fullName: string;
      nim: string;
      programStudi: string;
      jabatan: string;
      totalHadir: number;
      nominalShift: number;
      tunjanganKetua: number;
      totalNominal: number;
      lateCount: number;
      totalLateMinutes: number;
      shifts: string[];
    }>();

    const builtShifts: ShiftRow[] = [];

    for (const s of shiftRows) {
      const wibDate = wibDateOf(s.clockIn);
      const sesi = sesiByShift.get(s.id) ?? 'Pagi';
      const slotLabel = sesi === 'Siang' ? '11:30-15:00' : '07:00-11:30';

      const fin = finByShift.get(s.id) ?? { omzet: 0, labaKotor: 0, txCount: 0 };
      const poolGaji = poolByShift.get(s.id) ?? 0;

      const attendeesRaw = attByShift.get(s.id) ?? [];
      const count = attendeesRaw.length;
      const nominalPerOrang = count > 0 ? Math.round(poolGaji / count) : 0;

      const dayOfWeek = new Date(wibDate + 'T00:00:00+07:00').getDay();
      const hariStr = HARI[dayOfWeek] ?? wibDate;

      const evaluated = attendeesRaw.map((att) => {
        let roleTask = extractRoleFromNotes(att.notes, att.employee.jabatan);
        if (att.employee.id === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM) {
          roleTask = 'Ketua UMKM / Admin Shift';
        } else if (att.employee.id === s.employeeId && !att.notes?.startsWith('Peran: ')) {
          const rLower = roleTask.toLowerCase();
          if (!rLower.includes('admin') && !rLower.includes('kasir')) {
            roleTask = 'Kasir';
          }
        }

        const wInfo = computePersonnelWeight({
          role: roleTask,
          sesi,
          attendanceDate: wibDate,
          lateMinutes: att.lateMinutes,
        });

        return { att, roleTask, wInfo };
      });

      const personShares = allocateProportional(
        poolGaji,
        evaluated.map((e) => e.wInfo.totalWeight),
      );

      const personnel: AttendeeRow[] = evaluated.map(({ att, roleTask, wInfo }, idx) => {
        const share = personShares[idx] ?? 0;
        const empId = att.employee.id;
        const displayJabatan =
          empId === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM
            ? 'Ketua UMKM / Admin Shift'
            : att.employee.jabatan;

        if (!empAgg.has(empId)) {
          empAgg.set(empId, {
            employeeId: empId,
            fullName: att.employee.fullName,
            nim: att.employee.nim,
            programStudi: att.employee.programStudi,
            jabatan: displayJabatan,
            totalHadir: 0,
            nominalShift: 0,
            tunjanganKetua: 0,
            totalNominal: 0,
            lateCount: 0,
            totalLateMinutes: 0,
            shifts: [],
          });
        }
        const agg = empAgg.get(empId)!;
        agg.totalHadir += 1;
        agg.nominalShift += share;
        agg.totalNominal += share;
        if (wInfo.effectiveLateMinutes > 0) {
          agg.lateCount += 1;
          agg.totalLateMinutes += wInfo.effectiveLateMinutes;
        }
        agg.shifts.push(`${wibDate} ${sesi}`);

        return {
          employeeId: empId,
          fullName: att.employee.fullName,
          nim: att.employee.nim,
          programStudi: att.employee.programStudi,
          jabatan: roleTask,
          status: wInfo.effectiveLateMinutes > 0 ? 'TELAT' : 'HADIR',
          lateMinutes: wInfo.effectiveLateMinutes,
          penaltyPercent: wInfo.penaltyPercent,
          roleWeight: wInfo.roleWeight,
          sessionWeight: wInfo.sessionWeight,
          totalWeight: wInfo.totalWeight,
          nominalBagiHasil: share,
        };
      });

      builtShifts.push({
        shiftId: s.id,
        tanggal: wibDate,
        hari: hariStr,
        sesi,
        slotLabel,
        clockIn: s.clockIn.toISOString(),
        clockOut: s.clockOut?.toISOString() ?? null,
        kasirName: s.kasirName,
        kasirNim: s.kasirNim,
        txCount: fin.txCount,
        omzet: fin.omzet,
        labaKotor: fin.labaKotor,
        poolGaji,
        personnelCount: count,
        nominalPerOrang,
        personnel,
      });
    }

    const summaryPerEmployee = Array.from(empAgg.values())
      .sort((a, b) => b.totalNominal - a.totalNominal);

    const totalDistributed = builtShifts.reduce(
      (acc, curr) => acc + (curr.personnelCount > 0 ? curr.poolGaji : 0),
      0,
    );
    const sisaPool = Math.max(0, poolHakMahasiswa - totalDistributed);
    const labaBersihToko = Math.round(fs.labaKotor - fs.biayaOperasional - totalDistributed);

    return apiOk({
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        label: range.label,
        period: period ?? 'custom',
      },
      grandTotal: {
        omzet: fs.omzet,
        labaKotor: fs.labaKotor,
        biayaOperasional: fs.biayaOperasional,
        labaOperasionalBersih,
        poolGaji: poolHakMahasiswa,
        tunjanganKetua: 0,
        poolShiftMahasiswa,
        txCount: fs.txCount,
        totalDistributed,
        sisaPool,
        labaBersihToko,
      },
      shifts: builtShifts,
      summaryPerEmployee,
      scheduleTeams,
      availableMonths,
    });
  } catch (err) {
    console.error('[laporan/per-shift GET]', err);
    return apiError('Gagal mengambil laporan per shift', 500);
  }
}
