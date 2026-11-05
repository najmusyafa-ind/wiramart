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
  shiftCashMovements,
  transactionPayments,
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

/** Akun admin/testing/dosen yang DILARANG menerima bagi hasil upah mahasiswa */
function isExcludedAccount(name?: string | null, nim?: string | null): boolean {
  const lname = (name || '').toLowerCase();
  const lnim = (nim || '').trim();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '02405021' ||
    lnim === '02405015' ||
    lnim === '02405016' ||
    lnim === '02405050' ||
    lnim === '00000000'
  );
}

function wibDateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

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

    // 0c. Weekend (Sabtu/Minggu) tidak ada jadwal resmi Wiramart — query ini dihapus.

    // ─────────────────────────────────────────────────────────────
    // 1. Ambil semua shifts dalam rentang (TANPA filter nama testing)
    //    Filter testing hanya untuk tampilan laporan, bukan data shift.
    //    Kasir "testing" tetap punya laba dari shift → perlu diinclude.
    // ─────────────────────────────────────────────────────────────
    const rawShiftRows = await db
      .select({
        id: shifts.id,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
        serahTerimaDiff: shifts.serahTerimaDiff,
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

    // Filter: Hari Sabtu (6) & Minggu (0) bukan hari operasional resmi Wiramart.
    // Shift di hari weekend adalah data uji coba, diexclude dari laporan shift mahasiswa.
    const shiftRows = rawShiftRows.filter((s) => {
      const wib = wibDateOf(s.clockIn);
      const dow = new Date(`${wib}T00:00:00+07:00`).getDay();
      return dow !== 0 && dow !== 6;
    });

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

    // ── 2b. Audit Uang Kas & Laci per Shift (Petty Cash Movements & Cash Sales) ──
    const cashMovements = shiftIds.length > 0
      ? await db
          .select({
            shiftId:      shiftCashMovements.shiftId,
            movementType: shiftCashMovements.movementType,
            total:        sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
          })
          .from(shiftCashMovements)
          .where(inArray(shiftCashMovements.shiftId, shiftIds))
          .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType)
      : [];

    const cashOutMap = new Map<string, number>();
    const cashInMap  = new Map<string, number>();
    for (const m of cashMovements) {
      const val = parseFloat(m.total || '0');
      if (m.movementType === 'CASH_OUT') cashOutMap.set(m.shiftId, val);
      else if (m.movementType === 'CASH_IN')  cashInMap.set(m.shiftId, val);
    }

    const splitCash = shiftIds.length > 0
      ? await db
          .select({
            shiftId: transactions.shiftId,
            total:   sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(and(
            inArray(transactions.shiftId, shiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactionPayments.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
          ))
          .groupBy(transactions.shiftId)
      : [];

    const cashSalesMap = new Map<string, number>();
    for (const s of splitCash) {
      if (s.shiftId) {
        cashSalesMap.set(s.shiftId, (cashSalesMap.get(s.shiftId) ?? 0) + parseFloat(s.total || '0'));
      }
    }

    const directCash = shiftIds.length > 0
      ? await db
          .select({
            shiftId: transactions.shiftId,
            total:   sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
          })
          .from(transactions)
          .where(and(
            inArray(transactions.shiftId, shiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
            sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
          ))
          .groupBy(transactions.shiftId)
      : [];

    for (const d of directCash) {
      if (d.shiftId) {
        cashSalesMap.set(d.shiftId, (cashSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
      }
    }

    const empScheduleMap = new Map<string, { dayOfWeek: string; slotStart: string }[]>();
    for (const sr of scheduleRows) {
      const list = empScheduleMap.get(sr.employeeId) ?? [];
      list.push({ dayOfWeek: sr.dayOfWeek, slotStart: sr.slotStart });
      empScheduleMap.set(sr.employeeId, list);
    }

    const sesiByShift = new Map<string, 'Pagi' | 'Siang'>();
    const shiftIdsByDate = new Map<string, string[]>();
    const HARI_TO_ENUM: Record<number, string> = {
      0: 'MINGGU', 1: 'SENIN', 2: 'SELASA', 3: 'RABU', 4: 'KAMIS', 5: 'JUMAT', 6: 'SABTU',
    };

    for (const s of shiftRows) {
      const key = wibDateOf(s.clockIn);
      const list = shiftIdsByDate.get(key) ?? [];
      list.push(s.id);
      shiftIdsByDate.set(key, list);

      const dayOfWeekNum = new Date(`${key}T00:00:00+07:00`).getDay();
      const dayEnum = HARI_TO_ENUM[dayOfWeekNum] ?? '';

      // Penentuan Sesi Shift:
      // 1. Kamis: Wiramart HANYA punya jadwal sesi Siang (11:00-15:00)
      // 2. Jam buka >= 11:00 WIB -> Siang
      // 3. Jam buka >= 10:30 WIB dan kasir punya jadwal resmi Siang pada hari tsb -> Siang
      // 4. Selain itu -> Pagi (07:30-11:30)
      let sesi: 'Pagi' | 'Siang';
      if (dayOfWeekNum === 4) {
        sesi = 'Siang';
      } else {
        const inParts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        }).formatToParts(s.clockIn);
        const inHour = parseInt(inParts.find((p) => p.type === 'hour')?.value ?? '8', 10);
        const inMinute = parseInt(inParts.find((p) => p.type === 'minute')?.value ?? '0', 10);
        const clockMinutes = inHour * 60 + inMinute;

        if (clockMinutes >= 11 * 60) {
          sesi = 'Siang';
        } else if (clockMinutes >= 10 * 60 + 30) {
          const empScheds = empScheduleMap.get(s.employeeId) ?? [];
          const matchSched = empScheds.find((sch) => sch.dayOfWeek === dayEnum);
          const schedHour = matchSched ? parseInt(matchSched.slotStart.split(':')[0] ?? '11', 10) : 8;
          sesi = schedHour >= 11 ? 'Siang' : 'Pagi';
        } else {
          sesi = 'Pagi';
        }
      }

      sesiByShift.set(s.id, sesi);
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
        if (!isExcludedAccount(att.employee.fullName, att.employee.nim) && !seenEmp.has(att.employee.id)) {
          seenEmp.add(att.employee.id);
          deduped.push(att);
        }
      }

      if (!isExcludedAccount(s.kasirName, s.kasirNim) && !seenEmp.has(s.employeeId)) {
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
    // 4c. Alokasi Pool Shift — Rumus Hybrid 70/30 (Fair & Transparan)
    //
    //  70% → "Jatah Hadir" (Attendance Pool)
    //         Dibagi proporsional ke tiap shift berdasarkan total poin
    //         disiplin seluruh personelnya. Tiap orang hadir = 1 unit
    //         × faktor disiplin ketepatan waktu × bobot sesi.
    //
    //  30% → "Bonus Produktivitas" (Performance Pool)
    //         Dibagi proporsional ke shift berdasarkan laba kotor shift.
    //         Shift 0 transaksi = 0 bonus (tapi tetap dapat bagian 70%).
    //
    //  Hasilnya: Shift Selasa Siang 0-tx tidak lagi dapat Rp 0.
    //            Total pool 50% tetap terdistribusi tuntas (closed-loop).
    // ─────────────────────────────────────────────────────────────
    const poolShiftMahasiswa = poolHakMahasiswa;
    const ATTENDANCE_RATIO = 0.70;
    const PERFORMANCE_RATIO = 0.30;

    // Hitung total poin disiplin seluruh shift (untuk normalisasi Pool A)
    const shiftAttPoints: number[] = shiftRows.map((s) => {
      const atts = attByShift.get(s.id) ?? [];
      if (atts.length === 0) return 0;
      let sum = 0;
      for (const att of atts) {
        const wInfo = computePersonnelWeight({
          role: extractRoleFromNotes(att.notes, att.employee.jabatan),
          sesi: sesiByShift.get(s.id) ?? 'Pagi',
          attendanceDate: wibDateOf(s.clockIn),
          lateMinutes: att.lateMinutes,
        });
        sum += wInfo.totalWeight;
      }
      return sum;
    });
    const totalAttPoints = shiftAttPoints.reduce((a, b) => a + b, 0);

    // Hitung total laba kotor seluruh shift (untuk normalisasi Pool B)
    const shiftLabaKotor: number[] = shiftRows.map((s) => {
      const atts = attByShift.get(s.id) ?? [];
      if (atts.length === 0) return 0;
      return Math.max(0, finByShift.get(s.id)?.labaKotor ?? 0);
    });
    const totalLabaKotorAllShifts = shiftLabaKotor.reduce((a, b) => a + b, 0);

    // Gabungkan bobot: 70% attendance + 30% performance
    // Menggunakan cross-multiply agar tidak ada pembagian 0:
    //   combinedWeight[i] = attPoin[i] × totalLk + (lk[i] / totalLk × totalAttPoin) × totalLk
    //   Disederhanakan: (0.70 × attPoin[i] × totalLk) + (0.30 × lk[i] × totalAttPoin)
    const shiftWeights = shiftRows.map((_, idx) => {
      const att = shiftAttPoints[idx] ?? 0;
      const lk = shiftLabaKotor[idx] ?? 0;
      if (att === 0) return 0; // shift tanpa personel sah → dapat Rp 0
      const attendancePart = ATTENDANCE_RATIO * att * (totalLabaKotorAllShifts > 0 ? totalLabaKotorAllShifts : 1);
      const performancePart = PERFORMANCE_RATIO * lk * (totalAttPoints > 0 ? totalAttPoints : 1);
      return attendancePart + performancePart;
    });

    const shiftShares = allocateProportional(poolShiftMahasiswa, shiftWeights);
    const poolByShift = new Map<string, number>();
    shiftRows.forEach((s, idx) => {
      poolByShift.set(s.id, shiftShares[idx] ?? 0);
    });

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
      modalAwal: number;
      actualCash: number | null;
      expectedCash: number;
      discrepancy: number | null;
      shortageDeduction: number;
      gajiBersih: number;
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

      // Hitung selisih laci kasir & potong tekor otomatis
      const rawModal = s.modalAwal ? parseFloat(s.modalAwal) : 100_000;
      const modalAwal = rawModal > 150_000 ? 100_000 : (rawModal <= 0 ? 100_000 : rawModal);
      const actualCash = s.actualCash ? parseFloat(s.actualCash) : null;
      const cashSales = cashSalesMap.get(s.id) ?? 0;
      const cashOut = cashOutMap.get(s.id) ?? 0;
      const cashIn = cashInMap.get(s.id) ?? 0;
      const expectedCash = modalAwal + cashSales - cashOut + cashIn;
      const discrepancy = actualCash !== null ? actualCash - expectedCash : null;
      const shortageDeduction = (discrepancy !== null && discrepancy < -2000) ? Math.abs(discrepancy) : 0;
      // Pilihan 1 (Closed-Loop 50:50): Hak mahasiswa 50% adalah paten dan tidak dipotong sepihak oleh tekor fisik laci kasir,
      // sehingga Total Upah Shift (50%) = Kas Toko (50%) SAMA PERSIS 100%!
      const gajiBersih = poolGaji;

      const attendeesRaw = attByShift.get(s.id) ?? [];
      const count = attendeesRaw.length;
      const nominalPerOrang = count > 0 ? Math.round(gajiBersih / count) : 0;

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

        // Tidak ada lagi special case Minggu — weekend sudah di-exclude di tahap 4b
        return { att, roleTask, wInfo };
      });

      const personShares = allocateProportional(
        gajiBersih,
        evaluated.map((e) => e.wInfo.totalWeight),
      );

      const personnel: AttendeeRow[] = evaluated.map(({ att, roleTask, wInfo }, idx) => {
        const share = personShares[idx] ?? 0;
        const empId = att.employee.id;
        const displayJabatan =
          empId === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM
            ? 'Ketua UMKM / Admin Shift'
            : att.employee.jabatan;

        if (!isExcludedAccount(att.employee.fullName, att.employee.nim)) {
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
        }

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
        modalAwal,
        actualCash,
        expectedCash,
        discrepancy,
        shortageDeduction,
        gajiBersih,
        personnelCount: count,
        nominalPerOrang,
        personnel,
      });
    }

    const summaryPerEmployee = Array.from(empAgg.values())
      .sort((a, b) => b.totalNominal - a.totalNominal);

    // Rumus Hybrid 70/30: Total pool 50% terdistribusi tuntas (closed-loop, zero leakage)
    const totalDistributed = poolShiftMahasiswa;
    const sisaPool = 0;
    // Kas toko paten 50% dari Laba Bersih Operasional
    const labaBersihToko = fs.labaBersih;

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
