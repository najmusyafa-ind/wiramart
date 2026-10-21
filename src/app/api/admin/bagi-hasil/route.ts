// =============================================================
// GET /api/admin/bagi-hasil
// Endpoint untuk menghitung Alokasi Bagi Hasil 50% Karyawan (Paten Wiramart)
// Membagi porsi laba secara adil kepada anggota shift yang hadir/presensi
// Auth: sk_admin
// =============================================================

import { NextRequest } from 'next/server';
import { and, gte, lte, inArray, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, transactions, shifts } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { z } from 'zod';
import { resolveReportRange, getFinancialReport, type PeriodKey } from '@/lib/finance/report';

export const runtime = 'nodejs';

const BagiHasilQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'all']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Format bulan YYYY-MM').optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Khusus Admin/Manager.', 403);
  }
  if (session.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Perhitungan bagi hasil hanya dapat diakses oleh Manager.', 403);
  }

  const { searchParams } = new URL(req.url);
  const rawParams: Record<string, string> = {};
  searchParams.forEach((val, key) => {
    if (val) rawParams[key] = val;
  });

  const parsed = BagiHasilQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return apiError(
      `Parameter tidak valid: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    );
  }

  const { period, dateFrom, dateTo, startDate, endDate, date, month } = parsed.data;
  const periodParam = (period as PeriodKey) || null;
  const dateFromParam = dateFrom || startDate || date;
  const dateToParam = dateTo || endDate || date;
  const monthParam = month; // 'YYYY-MM'

  try {
    let effectiveDateFrom = dateFromParam;
    let effectiveDateTo = dateToParam;

    if (monthParam) {
      effectiveDateFrom = `${monthParam}-01`;
      const [y, m] = monthParam.split('-').map(Number);
      const lastDay = new Date(y ?? 2026, m ?? 1, 0).getDate();
      effectiveDateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
    }

    const range = resolveReportRange({
      period: (periodParam || (!effectiveDateFrom ? 'daily' : null)) as PeriodKey | null,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
    });

    // 1. Ambil laporan keuangan resmi untuk rentang ini
    const financial = await getFinancialReport(range);

    // 1b. Ambil laba kotor transaksi per shift dalam rentang waktu ini
    const shiftProfits = await db
      .select({
        shiftId: transactions.shiftId,
        grossProfit: sql<string>`COALESCE(SUM(${transactions.grossProfit}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          gte(transactions.createdAt, range.start),
          lt(transactions.createdAt, range.endExclusive),
        ),
      )
      .groupBy(transactions.shiftId);

    const profitByShiftId = new Map<string, number>();
    for (const sp of shiftProfits) {
      if (sp.shiftId) {
        profitByShiftId.set(sp.shiftId, parseFloat(sp.grossProfit));
      }
    }

    // Ambil shifts dalam rentang waktu ini untuk memetakan jam shift
    const shiftList = await db.query.shifts.findMany({
      where: and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)),
      columns: { id: true, employeeId: true, clockIn: true, clockOut: true },
    });

    // 2. Ambil absensi yang hadir (HADIR, TELAT, PENGGANTI) pada rentang ini
    const attList = await db.query.attendances.findMany({
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
          columns: { dayOfWeek: true, slotStart: true, slotEnd: true },
        },
      },
      orderBy: [desc(attendances.attendanceDate), attendances.scheduleId],
    });

    // 3. Kelompokkan kehadiran per tanggal
    const attByDate = new Map<string, typeof attList>();
    for (const att of attList) {
      if (!attByDate.has(att.attendanceDate)) {
        attByDate.set(att.attendanceDate, []);
      }
      attByDate.get(att.attendanceDate)!.push(att);
    }

    // 4. Hitung pembagian harian & akumulasi per karyawan
    type WorkerDetail = {
      attendanceId: string;
      employeeId: string;
      fullName: string;
      nim: string;
      programStudi: string;
      jabatan: string;
      roleTask: string;
      slotStart: string;
      slotEnd: string;
      status: string;
      clockInActual: string | null;
      clockOutActual: string | null;
      lateMinutes: number;
      nominalBagiHasil: number;
    };

    type DailyDivision = {
      date: string;
      omzet: number;
      labaKotor: number;
      biayaOperasional: number;
      poolBagiHasil: number;
      personnelCount: number;
      nominalPerOrang: number;
      personnel: WorkerDetail[];
    };

    const dailyBreakdowns: DailyDivision[] = [];
    const empAggMap = new Map<string, {
      employeeId: string;
      fullName: string;
      nim: string;
      programStudi: string;
      jabatan: string;
      totalHadir: number;
      totalMenitKerja: number;
      totalNominal: number;
    }>();

    // Map laba harian dari finance report
    const financialDailyMap = new Map(financial.daily.map((d) => [d.date, d]));

    // Buat daftar tanggal lengkap dari range
    for (const d of financial.daily) {
      const attendees = attByDate.get(d.date) ?? [];
      const poolHariIni = d.alokasiGajiKaryawan ?? 0;
      const count = attendees.length;

      // Filter shift pada tanggal d.date (WIB)
      const shiftsOnDate = shiftList.filter((s) => {
        const wibDate = new Date(s.clockIn.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        return wibDate === d.date;
      });

      const hasMultiShift = shiftsOnDate.length > 1;
      const shiftPoolMap = new Map<string, { pool: number; attendees: typeof attendees }>();

      if (hasMultiShift) {
        for (const s of shiftsOnDate) {
          const profit = profitByShiftId.get(s.id) ?? 0;
          const pool = Math.floor(profit * 0.5);
          shiftPoolMap.set(s.id, { pool, attendees: [] });
        }

        // Multi-tier matching:
        // Tier 1: Direct att.shiftId
        // Tier 2: att.employeeId === s.employeeId
        // Tier 3: Time interval matching via clockInActual
        // Tier 4: Schedule slot heuristic (Morning 07:30-11:30 vs Afternoon 11:00-15:00)
        // Tier 5: Fallback to shiftsOnDate[0]
        for (const att of attendees) {
          let matchedShift: typeof shiftsOnDate[0] | undefined;

          // Tier 1: Direct shift_id foreign key
          if (att.shiftId) {
            matchedShift = shiftsOnDate.find((s) => s.id === att.shiftId);
          }

          // Tier 2: Employee who owns the shift session
          if (!matchedShift) {
            matchedShift = shiftsOnDate.find((s) => s.employeeId === att.employeeId);
          }

          // Tier 3: Actual login clock-in timestamp match (with 30m window)
          if (!matchedShift && att.clockInActual) {
            const attTime = new Date(att.clockInActual).getTime();
            matchedShift = shiftsOnDate.find((s) => {
              const sIn = s.clockIn.getTime();
              const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
              return attTime >= sIn - 30 * 60 * 1000 && attTime <= sOut + 30 * 60 * 1000;
            });
          }

          // Tier 4: Schedule slotStart heuristic
          if (!matchedShift) {
            const slotHour = att.schedule?.slotStart ? parseInt(att.schedule.slotStart.split(':')[0] ?? '8', 10) : 8;
            for (const s of shiftsOnDate) {
              const shiftHourWib = new Date(s.clockIn.getTime() + 7 * 3600 * 1000).getUTCHours();
              if (slotHour >= 11 && shiftHourWib >= 11) {
                matchedShift = s;
                break;
              } else if (slotHour < 11 && shiftHourWib < 11) {
                matchedShift = s;
                break;
              }
            }
          }

          // Tier 5: Safe fallback
          if (!matchedShift && shiftsOnDate.length > 0) {
            matchedShift = shiftsOnDate[0];
          }

          if (matchedShift && shiftPoolMap.has(matchedShift.id)) {
            shiftPoolMap.get(matchedShift.id)!.attendees.push(att);
          }
        }

        // Zero-Leakage Guard: jika ada shift yang menghasilkan laba tapi tidak ada hadirin yang terpetakan,
        // alihkan sisa pool tersebut secara proporsional ke hadirin shift lain pada tanggal yang sama.
        let unallocatedShiftPool = 0;
        let activeAttendeesCount = 0;
        for (const [, group] of shiftPoolMap.entries()) {
          if (group.attendees.length === 0) {
            unallocatedShiftPool += group.pool;
            group.pool = 0;
          } else {
            activeAttendeesCount += group.attendees.length;
          }
        }
        if (unallocatedShiftPool > 0 && activeAttendeesCount > 0) {
          const bonusPerAttendee = Math.floor(unallocatedShiftPool / activeAttendeesCount);
          for (const [, group] of shiftPoolMap.entries()) {
            if (group.attendees.length > 0) {
              group.pool += bonusPerAttendee * group.attendees.length;
            }
          }
        }
      }

      // Hitung nominal bagi hasil per orang (sesuai shift jika multi-shift)
      const attendeeNominalMap = new Map<string, number>();
      if (hasMultiShift) {
        for (const [, group] of shiftPoolMap.entries()) {
          const groupCount = group.attendees.length;
          const nominalGroup = groupCount > 0 ? Math.floor(group.pool / groupCount) : 0;
          for (const a of group.attendees) {
            attendeeNominalMap.set(a.id, nominalGroup);
          }
        }
      } else {
        const nominalRata = count > 0 ? Math.floor(poolHariIni / count) : 0;
        for (const a of attendees) {
          attendeeNominalMap.set(a.id, nominalRata);
        }
      }

      const defaultNominal = count > 0 ? Math.floor(poolHariIni / count) : 0;

      const personnelDetails: WorkerDetail[] = attendees.map((att) => {
        const nominalPerOrang = attendeeNominalMap.get(att.id) ?? defaultNominal;

        // Ekstrak peran dari notes jika ada (cth: "Peran: Kasir | ...")
        let roleTask = att.employee.jabatan;
        if (att.notes?.startsWith('Peran: ')) {
          const match = att.notes.match(/^Peran:\s*([^|]+)/);
          if (match && match[1]) {
            roleTask = match[1].trim();
          }
        }

        // Hitung menit kerja jika ada clock in & out
        let durasiMenit = 0;
        if (att.clockInActual && att.clockOutActual) {
          durasiMenit = Math.max(0, Math.round(
            (new Date(att.clockOutActual).getTime() - new Date(att.clockInActual).getTime()) / 60000
          ));
        }

        // Akumulasi ke ringkasan per karyawan
        const empId = att.employee.id;
        if (!empAggMap.has(empId)) {
          empAggMap.set(empId, {
            employeeId: empId,
            fullName: att.employee.fullName,
            nim: att.employee.nim,
            programStudi: att.employee.programStudi,
            jabatan: att.employee.jabatan,
            totalHadir: 0,
            totalMenitKerja: 0,
            totalNominal: 0,
          });
        }
        const agg = empAggMap.get(empId)!;
        agg.totalHadir += 1;
        agg.totalMenitKerja += durasiMenit;
        agg.totalNominal += nominalPerOrang;

        return {
          attendanceId: att.id,
          employeeId: att.employee.id,
          fullName: att.employee.fullName,
          nim: att.employee.nim,
          programStudi: att.employee.programStudi,
          jabatan: att.employee.jabatan,
          roleTask,
          slotStart: att.schedule.slotStart,
          slotEnd: att.schedule.slotEnd,
          status: att.status,
          clockInActual: att.clockInActual ? att.clockInActual.toISOString() : null,
          clockOutActual: att.clockOutActual ? att.clockOutActual.toISOString() : null,
          lateMinutes: att.lateMinutes,
          nominalBagiHasil: nominalPerOrang,
        };
      });

      dailyBreakdowns.push({
        date: d.date,
        omzet: d.omzet,
        labaKotor: d.labaKotor,
        biayaOperasional: d.biayaOperasional,
        poolBagiHasil: poolHariIni,
        personnelCount: count,
        nominalPerOrang: defaultNominal,
        personnel: personnelDetails,
      });
    }

    const summaryPerEmployee = Array.from(empAggMap.values())
      .sort((a, b) => b.totalNominal - a.totalNominal);

    return apiOk({
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        label: range.label,
        period: range.period,
      },
      summary: {
        totalOmzet: financial.summary.omzet,
        totalLabaKotor: financial.summary.labaKotor,
        totalBiayaOperasional: financial.summary.biayaOperasional,
        totalAlokasiKaryawan: financial.summary.alokasiGajiKaryawan,
        totalLabaBersihToko: financial.summary.labaBersih,
        totalPersonelAktif: summaryPerEmployee.length,
      },
      summaryPerEmployee,
      dailyBreakdowns,
    });
  } catch (err) {
    console.error('[bagi-hasil GET]', err);
    return apiError('Gagal menghitung alokasi bagi hasil karyawan.', 500);
  }
}
