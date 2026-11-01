// =============================================================
// GET /api/admin/bagi-hasil
// Endpoint untuk menghitung Alokasi Bagi Hasil 50% Karyawan (Paten Wiramart)
// Membagi porsi laba secara adil kepada anggota shift yang hadir/presensi
// Auth: sk_admin
// =============================================================

import { NextRequest } from 'next/server';
import { and, gte, lte, inArray, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, transactions, transactionItems, shifts, employees } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { z } from 'zod';
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
    const poolHakMahasiswa = financial.summary.alokasiGajiKaryawan;
    const tunjanganKetua = poolHakMahasiswa > 0
      ? Math.round((poolHakMahasiswa * PERSEN_TUNJANGAN_KETUA) / 100)
      : 0;
    const poolShiftMahasiswa = Math.max(0, poolHakMahasiswa - tunjanganKetua);

    const dailyShiftShares = allocateProportional(
      poolShiftMahasiswa,
      financial.daily.map((d) => d.alokasiGajiKaryawan),
    );
    const dayShiftPoolMap = new Map<string, number>();
    financial.daily.forEach((d, idx) => {
      dayShiftPoolMap.set(d.date, dailyShiftShares[idx] ?? 0);
    });

    // Ambil shifts dalam rentang waktu ini beserta data kasir
    const shiftRows = await db
      .select({
        id:           shifts.id,
        clockIn:      shifts.clockIn,
        clockOut:     shifts.clockOut,
        employeeId:   shifts.employeeId,
        kasirName:    employees.fullName,
        kasirNim:     employees.nim,
        kasirProdi:   employees.programStudi,
        kasirJabatan: employees.jabatan,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
      .orderBy(shifts.clockIn);

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
    const profitByShiftId = new Map<string, number>();
    if (shiftIds.length > 0) {
      const shiftProfits = await db
        .select({
          shiftId:   transactions.shiftId,
          labaKotor: sql<string>`ROUND(COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalSell} - ${transactionItems.subtotalCost} ELSE 0 END), 0))`,
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

      for (const sp of shiftProfits) {
        if (sp.shiftId) {
          profitByShiftId.set(sp.shiftId, parseFloat(sp.labaKotor || '0'));
        }
      }
    }

    const wibDateOf = (d: Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
    const sesiOfShift = (clockIn: Date): 'Pagi' | 'Siang' => {
      const wibHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false,
        }).format(clockIn),
        10
      );
      return wibHour >= 11 ? 'Siang' : 'Pagi';
    };

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

    for (const att of attList) {
      if (att.employeeId === KETUA_UMKM_DUPLICATE_ID || att.employee.nim === KETUA_UMKM_NIM) {
        att.employeeId = KETUA_UMKM_CANONICAL_ID;
        att.employee.id = KETUA_UMKM_CANONICAL_ID;
        att.employee.fullName = 'Gita Aprilianingrum';
        att.employee.nim = KETUA_UMKM_NIM;
        att.employee.programStudi = 'Akuntansi';
        att.employee.jabatan = 'Ketua UMKM / Admin Shift';
      }
    }

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

    // Buat daftar tanggal lengkap dari range
    for (const d of financial.daily) {
      const rawAttendees = attByDate.get(d.date) ?? [];
      const poolHariIni = dayShiftPoolMap.get(d.date) ?? 0;

      // Filter shift pada tanggal d.date (WIB)
      const shiftsOnDate = shiftRows.filter((s) => wibDateOf(s.clockIn) === d.date);
      const shiftPoolMap = new Map<string, {
        shift: typeof shiftsOnDate[0];
        sesi: 'Pagi' | 'Siang';
        pool: number;
        attendees: typeof rawAttendees;
      }>();

      for (const s of shiftsOnDate) {
        shiftPoolMap.set(s.id, {
          shift: s,
          sesi: sesiOfShift(s.clockIn),
          pool: 0,
          attendees: [],
        });
      }

      // Petakan absensi ke shift pada tanggal tersebut
      const unmatchedAttendees: typeof rawAttendees = [];
      for (const att of rawAttendees) {
        let matchedShift: typeof shiftsOnDate[0] | undefined;

        if (att.shiftId) {
          matchedShift = shiftsOnDate.find((s) => s.id === att.shiftId);
        }
        if (!matchedShift) {
          matchedShift = shiftsOnDate.find((s) => s.employeeId === att.employeeId);
        }
        if (!matchedShift && att.clockInActual) {
          const attTime = new Date(att.clockInActual).getTime();
          matchedShift = shiftsOnDate.find((s) => {
            const sIn = s.clockIn.getTime();
            const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
            return attTime >= sIn - 30 * 60 * 1000 && attTime <= sOut + 30 * 60 * 1000;
          });
        }
        if (!matchedShift && att.schedule?.slotStart) {
          const slotHour = parseInt(att.schedule.slotStart.split(':')[0] ?? '8', 10);
          const isAfternoon = slotHour >= 11;
          matchedShift = shiftsOnDate.find((s) => {
            const isSiang = sesiOfShift(s.clockIn) === 'Siang';
            return isAfternoon === isSiang;
          });
        }
        if (!matchedShift && shiftsOnDate.length === 1) {
          matchedShift = shiftsOnDate[0];
        }

        if (matchedShift && shiftPoolMap.has(matchedShift.id)) {
          const group = shiftPoolMap.get(matchedShift.id)!;
          if (!group.attendees.some((x) => x.employee.id === att.employee.id)) {
            group.attendees.push(att);
          }
        } else {
          unmatchedAttendees.push(att);
        }
      }

      // Auto-integrasi kasir shift jika belum masuk daftar hadir
      for (const s of shiftsOnDate) {
        const isTesting = s.kasirName.toLowerCase().includes('testing') || s.kasirNim === '02405013';
        if (isTesting) continue;
        const group = shiftPoolMap.get(s.id)!;
        if (!group.attendees.some((x) => x.employee.id === s.employeeId)) {
          const sesi = group.sesi;
          group.attendees.push({
            id: `shift-kasir-${s.id}`,
            employeeId: s.employeeId,
            scheduleId: '',
            shiftId: s.id,
            attendanceDate: d.date,
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
              slotStart: sesi === 'Siang' ? '11:30' : '07:00',
              slotEnd: sesi === 'Siang' ? '15:00' : '11:30',
              dayOfWeek: 'SENIN',
            },
          });
        }
      }

      // Alokasi poolHariIni ke shift-shift pada tanggal ini dengan bobot Laba Kotor × Durasi Sesi
      const attendeeNominalMap = new Map<string, { nominal: number; roleTask: string; effectiveLate: number }>();
      const allDayAttendees: typeof rawAttendees = [];

      if (shiftsOnDate.length > 0) {
        const hasAnyAttendee = shiftsOnDate.some(
          (s) => (shiftPoolMap.get(s.id)?.attendees.length ?? 0) > 0,
        );
        const shiftWeights = shiftsOnDate.map((s) => {
          const group = shiftPoolMap.get(s.id)!;
          if (hasAnyAttendee && group.attendees.length === 0) return 0;
          const lk = Math.max(0, profitByShiftId.get(s.id) ?? 0);
          return lk * getSessionDurationWeight(group.sesi);
        });
        const shiftShares = allocateProportional(poolHariIni, shiftWeights);

        shiftsOnDate.forEach((s, i) => {
          const group = shiftPoolMap.get(s.id)!;
          group.pool = shiftShares[i] ?? 0;

          const evaluated = group.attendees.map((att) => {
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
              sesi: group.sesi,
              attendanceDate: d.date,
              lateMinutes: att.lateMinutes,
            });
            return { att, roleTask, wInfo };
          });

          const pShares = allocateProportional(
            group.pool,
            evaluated.map((e) => e.wInfo.totalWeight),
          );
          evaluated.forEach(({ att, roleTask, wInfo }, idx) => {
            attendeeNominalMap.set(att.id, {
              nominal: pShares[idx] ?? 0,
              roleTask,
              effectiveLate: wInfo.effectiveLateMinutes,
            });
            allDayAttendees.push(att);
          });
        });
      } else if (unmatchedAttendees.length > 0) {
        const evaluated = unmatchedAttendees.map((att) => {
          const roleTask = extractRoleFromNotes(att.notes, att.employee.jabatan);
          const slotH = parseInt(att.schedule?.slotStart?.split(':')[0] ?? '8', 10);
          const sesi: 'Pagi' | 'Siang' = slotH >= 11 ? 'Siang' : 'Pagi';
          const wInfo = computePersonnelWeight({
            role: roleTask,
            sesi,
            attendanceDate: d.date,
            lateMinutes: att.lateMinutes,
          });
          return { att, roleTask, wInfo };
        });
        const pShares = allocateProportional(
          poolHariIni,
          evaluated.map((e) => e.wInfo.totalWeight),
        );
        evaluated.forEach(({ att, roleTask, wInfo }, idx) => {
          attendeeNominalMap.set(att.id, {
            nominal: pShares[idx] ?? 0,
            roleTask,
            effectiveLate: wInfo.effectiveLateMinutes,
          });
          allDayAttendees.push(att);
        });
      }

      const count = allDayAttendees.length;
      const defaultNominal = count > 0 ? Math.round(poolHariIni / count) : 0;

      const personnelDetails: WorkerDetail[] = allDayAttendees.map((att) => {
        const info = attendeeNominalMap.get(att.id);
        const nominalPerOrang = info?.nominal ?? 0;
        const roleTask = info?.roleTask ?? extractRoleFromNotes(att.notes, att.employee.jabatan);
        const effectiveLate = info?.effectiveLate ?? 0;

        let durasiMenit = 0;
        if (att.clockInActual && att.clockOutActual) {
          durasiMenit = Math.max(0, Math.round(
            (new Date(att.clockOutActual).getTime() - new Date(att.clockInActual).getTime()) / 60000
          ));
        }

        const empId = att.employee.id;
        const displayJabatan =
          empId === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM
            ? 'Ketua UMKM / Admin Shift'
            : att.employee.jabatan;

        if (!empAggMap.has(empId)) {
          empAggMap.set(empId, {
            employeeId: empId,
            fullName: att.employee.fullName,
            nim: att.employee.nim,
            programStudi: att.employee.programStudi,
            jabatan: displayJabatan,
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
          jabatan: displayJabatan,
          roleTask,
          slotStart: att.schedule?.slotStart ?? '07:00',
          slotEnd: att.schedule?.slotEnd ?? '11:30',
          status: effectiveLate > 0 ? 'TELAT' : 'HADIR',
          clockInActual: att.clockInActual ? att.clockInActual.toISOString() : null,
          clockOutActual: att.clockOutActual ? att.clockOutActual.toISOString() : null,
          lateMinutes: effectiveLate,
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

    const totalShiftDistributed = Array.from(empAggMap.values()).reduce(
      (acc, curr) => acc + curr.totalNominal,
      0,
    );
    if (tunjanganKetua > 0 && totalShiftDistributed > 0) {
      if (!empAggMap.has(KETUA_UMKM_CANONICAL_ID)) {
        empAggMap.set(KETUA_UMKM_CANONICAL_ID, {
          employeeId: KETUA_UMKM_CANONICAL_ID,
          fullName: 'Gita Aprilianingrum',
          nim: KETUA_UMKM_NIM,
          programStudi: 'Akuntansi',
          jabatan: 'Ketua UMKM / Admin Shift',
          totalHadir: 0,
          totalMenitKerja: 0,
          totalNominal: 0,
        });
      }
      const ketuaAgg = empAggMap.get(KETUA_UMKM_CANONICAL_ID)!;
      ketuaAgg.jabatan = 'Ketua UMKM / Admin Shift';
      ketuaAgg.totalNominal += tunjanganKetua;
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
