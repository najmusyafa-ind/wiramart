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
} from '@/lib/db/schema';
import { and, eq, gte, lte, lt, inArray, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { resolveReportRange, getFinancialReport, type PeriodKey } from '@/lib/finance/report';

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
    // 1. Ambil semua shifts dalam rentang (TANPA filter nama testing)
    //    Filter testing hanya untuk tampilan laporan, bukan data shift.
    //    Kasir "testing" tetap punya laba dari shift → perlu diinclude.
    // ─────────────────────────────────────────────────────────────
    const shiftRows = await db
      .select({
        id:           shifts.id,
        clockIn:      shifts.clockIn,
        clockOut:     shifts.clockOut,
        status:       shifts.status,
        employeeId:   shifts.employeeId,
        kasirName:    employees.fullName,
        kasirNim:     employees.nim,
        kasirProdi:   employees.programStudi,
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

    if (shiftRows.length === 0) {
      return apiOk({
        range: { startDate: range.startDate, endDate: range.endDate, label: range.label },
        shifts: [],
        summaryPerEmployee: [],
        availableMonths,
        grandTotal: {
          omzet: financial.summary.omzet,
          labaKotor: financial.summary.labaKotor,
          biayaOperasional: financial.summary.biayaOperasional,
          labaOperasionalBersih: Math.max(0, financial.summary.labaKotor - financial.summary.biayaOperasional),
          poolGaji: financial.summary.alokasiGajiKaryawan,
          txCount: financial.summary.txCount,
          totalDistributed: 0,
          sisaPool: financial.summary.alokasiGajiKaryawan,
          labaBersihToko: financial.summary.labaBersih,
        },
      });
    }

    const shiftIds = shiftRows.map((s) => s.id);

    // ─────────────────────────────────────────────────────────────
    // 2. Hitung laba kotor per shift dari SNAPSHOT item (audit-proof)
    //    Formula: SUM(subtotal_sell - subtotal_cost) di mana cost > 0
    //    Produk HPP=0 (dummy/selisih laci) TIDAK dihitung sebagai laba
    // ─────────────────────────────────────────────────────────────
    const shiftFinancials = await db
      .select({
        shiftId:    transactions.shiftId,
        omzet:      sql<string>`ROUND(COALESCE(SUM(${transactionItems.subtotalSell}), 0))`,
        labaKotor:  sql<string>`ROUND(COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalSell} - ${transactionItems.subtotalCost} ELSE 0 END), 0))`,
        txCount:    sql<number>`COUNT(DISTINCT ${transactions.id})::int`,
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
          omzet:     parseFloat(f.omzet || '0'),
          labaKotor: parseFloat(f.labaKotor || '0'),
          txCount:   f.txCount,
        });
      }
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

    // Index absensi per shift (tier 1: shiftId FK langsung)
    const attByShift = new Map<string, typeof attRows>();
    const attOrphan: typeof attRows = []; // absensi tanpa shift_id

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
    // 4. Matching absensi orphan ke shift via heuristik (Tier 2-4)
    //    (untuk fix bug Rp 628.509 yang belum di-backfill)
    // ─────────────────────────────────────────────────────────────
    for (const att of attOrphan) {
      // Kandidat: shift pada tanggal yang sama
      const attDate = att.attendanceDate; // 'YYYY-MM-DD'
      const candidates = shiftRows.filter((s) => {
        const wibDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(s.clockIn);
        return wibDate === attDate;
      });
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
          const sIn  = s.clockIn.getTime();
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
          return isAfternoon ? parseInt(sHour) >= 11 : parseInt(sHour) < 11;
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
    // 4b. Integrasi Kasir Shift (Auto-Include Kasir jika belum di list)
    //     Kasir yang membuka sesi laci & melayani transaksi jelas bertugas di shift itu.
    //     Ini memastikan shift sebelum aktivasi kiosk (Agustus, September, awal Oktober)
    //     serta shift di mana kasir tidak sempat tap kiosk tetap mendapatkan hak bagi hasil.
    // ─────────────────────────────────────────────────────────────
    for (const s of shiftRows) {
      if (s.kasirName.toLowerCase().includes('testing') || s.kasirNim === '02405013') continue;

      const list = attByShift.get(s.id) ?? [];
      if (!list.some((att) => att.employee.id === s.employeeId)) {
        list.push({
          id: `shift-kasir-${s.id}`,
          employeeId: s.employeeId,
          scheduleId: null,
          shiftId: s.id,
          attendanceDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(s.clockIn),
          clockInActual: s.clockIn,
          clockOutActual: s.clockOut,
          status: 'HADIR',
          lateMinutes: 0,
          notes: 'Auto-integrated shift cashier',
          createdAt: s.clockIn,
          updatedAt: s.clockIn,
          employee: {
            id: s.employeeId,
            fullName: s.kasirName,
            nim: s.kasirNim,
            programStudi: s.kasirProdi,
            jabatan: s.kasirJabatan || 'Kasir',
          },
          schedule: null,
        } as any);
        attByShift.set(s.id, list);
      }
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
      poolGaji: number;      // 50% dari labaKotor
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
      totalNominal: number;
      shifts: string[];
    }>();

    const builtShifts: ShiftRow[] = [];
    let grandOmzet = 0, grandLaba = 0, grandPool = 0, grandTx = 0;

    for (const s of shiftRows) {
      const wibDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(s.clockIn);
      const wibHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false,
        }).format(s.clockIn),
        10
      );
      const isSiang = wibHour >= 11;
      const sesi: 'Pagi' | 'Siang' = isSiang ? 'Siang' : 'Pagi';
      const slotLabel = isSiang ? '11:30-15:00' : '07:00-11:30';

      const fin = finByShift.get(s.id) ?? { omzet: 0, labaKotor: 0, txCount: 0 };
      // Pool hanya dihitung jika laba positif (laba minus = tidak ada pool)
      const poolGaji = fin.labaKotor > 0 ? Math.floor(fin.labaKotor * 0.5) : 0;

      grandOmzet += fin.omzet;
      grandLaba  += fin.labaKotor;
      grandPool  += poolGaji;
      grandTx    += fin.txCount;

      const attendeesRaw = attByShift.get(s.id) ?? [];
      const count = attendeesRaw.length;
      const nominalPerOrang = count > 0 ? Math.floor(poolGaji / count) : 0;

      const dayOfWeek = new Date(wibDate + 'T00:00:00+07:00').getDay();
      const hariStr = HARI[dayOfWeek] ?? wibDate;

      const personnel: AttendeeRow[] = attendeesRaw.map((att) => {
        const empId = att.employee.id;
        if (!empAgg.has(empId)) {
          empAgg.set(empId, {
            employeeId: empId,
            fullName: att.employee.fullName,
            nim: att.employee.nim,
            programStudi: att.employee.programStudi,
            jabatan: att.employee.jabatan,
            totalHadir: 0,
            totalNominal: 0,
            shifts: [],
          });
        }
        const agg = empAgg.get(empId)!;
        agg.totalHadir += 1;
        agg.totalNominal += nominalPerOrang;
        agg.shifts.push(`${wibDate} ${sesi}`);

        return {
          employeeId: empId,
          fullName: att.employee.fullName,
          nim: att.employee.nim,
          programStudi: att.employee.programStudi,
          jabatan: att.employee.jabatan,
          status: att.status,
          lateMinutes: att.lateMinutes ?? 0,
          nominalBagiHasil: nominalPerOrang,
        };
      });

      builtShifts.push({
        shiftId:        s.id,
        tanggal:        wibDate,
        hari:           hariStr,
        sesi,
        slotLabel,
        clockIn:        s.clockIn.toISOString(),
        clockOut:       s.clockOut?.toISOString() ?? null,
        kasirName:      s.kasirName,
        kasirNim:       s.kasirNim,
        txCount:        fin.txCount,
        omzet:          fin.omzet,
        labaKotor:      fin.labaKotor,
        poolGaji,
        personnelCount: count,
        nominalPerOrang,
        personnel,
      });
    }

    const summaryPerEmployee = Array.from(empAgg.values())
      .sort((a, b) => b.totalNominal - a.totalNominal);

    const totalDistributed = summaryPerEmployee.reduce((acc, curr) => acc + curr.totalNominal, 0);

    const grandLabaRounded = Math.round(grandLaba);
    const biayaOperasional = financial.summary.biayaOperasional;
    const labaOperasionalBersih = Math.max(0, grandLabaRounded - biayaOperasional);
    const poolHakMahasiswa = financial.summary.alokasiGajiKaryawan;
    const sisaPool = Math.max(0, poolHakMahasiswa - totalDistributed);
    const labaBersihToko = Math.max(0, grandLabaRounded - totalDistributed - biayaOperasional);

    return apiOk({
      range: {
        startDate: range.startDate,
        endDate:   range.endDate,
        label:     range.label,
        period:    period ?? 'custom',
      },
      grandTotal: {
        omzet:                 Math.round(grandOmzet),
        labaKotor:             grandLabaRounded,
        biayaOperasional,
        labaOperasionalBersih,
        poolGaji:              poolHakMahasiswa,
        txCount:               grandTx,
        totalDistributed,
        sisaPool,
        labaBersihToko,
      },
      shifts: builtShifts,
      summaryPerEmployee,
      availableMonths,
    });
  } catch (err) {
    console.error('[laporan/per-shift GET]', err);
    return apiError('Gagal mengambil laporan per shift', 500);
  }
}
