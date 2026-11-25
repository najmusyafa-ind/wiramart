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
  extractRoleFromNotes,
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
  if (!session || session.role !== 'admin' || session.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Pembagian bagi hasil 50:50 khusus Manager (Dosen).', 403);
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

    // 1. Ambil laporan keuangan resmi untuk rentang ini (Mode Pembagian Utuh Per Shift)
    const financial = await getFinancialReport(range);
    const poolHakMahasiswa = financial.summary.alokasiGajiKaryawan;
    const poolShiftMahasiswa = Math.max(0, poolHakMahasiswa);

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
        id: shifts.id,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        employeeId: shifts.employeeId,
        kasirName: employees.fullName,
        kasirNim: employees.nim,
        kasirProdi: employees.programStudi,
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
          shiftId: transactions.shiftId,
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
    const wibMinutesOf = (d: Date): number => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(d);
      const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
      const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
      return h * 60 + m;
    };
    const sesiOfShift = (
      clockIn: Date,
      clockOut: Date | null,
      hasEarlierSameDay: boolean,
    ): 'Pagi' | 'Siang' => {
      const inMin = wibMinutesOf(clockIn);
      if (inMin >= 11 * 60) return 'Siang';
      if (inMin >= 10 * 60 + 30 && hasEarlierSameDay && clockOut && wibMinutesOf(clockOut) >= 14 * 60) {
        return 'Siang';
      }
      return 'Pagi';
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
    const shiftGroupAggMap = new Map<string, {
      groupKey: string;
      hari: string;
      sesi: 'Pagi' | 'Siang';
      totalShiftCount: number;
      totalPoolShift: number;
      memberNames: Set<string>;
    }>();
    const HARI_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayOfDate = (dateStr: string): string => {
      const [y, m, day] = dateStr.split('-').map(Number);
      const dow = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, day ?? 1, 12)).getUTCDay();
      return HARI_NAMES[dow] ?? dateStr;
    };

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

      shiftsOnDate.forEach((s, idx) => {
        shiftPoolMap.set(s.id, {
          shift: s,
          sesi: sesiOfShift(s.clockIn, s.clockOut, idx > 0),
          pool: 0,
          attendees: [],
        });
      });

      // Petakan absensi ke shift pada tanggal tersebut (STRICT SESSION BOUNDARY — anti 7-orang bug & aman dobel shift)
      const unmatchedAttendees: typeof rawAttendees = [];
      for (const att of rawAttendees) {
        let matchedShift: typeof shiftsOnDate[0] | undefined;

        if (att.shiftId) {
          matchedShift = shiftsOnDate.find((s) => s.id === att.shiftId);
        }

        if (!matchedShift) {
          const attSlotHour = att.schedule?.slotStart
            ? parseInt(att.schedule.slotStart.split(':')[0] ?? '', 10)
            : Number.NaN;
          const attSesi: 'Pagi' | 'Siang' | null = Number.isNaN(attSlotHour)
            ? null
            : attSlotHour >= 11
              ? 'Siang'
              : 'Pagi';

          const sameSessionShifts = attSesi
            ? shiftsOnDate.filter((s) => shiftPoolMap.get(s.id)?.sesi === attSesi)
            : shiftsOnDate;

          if (sameSessionShifts.length > 0) {
            matchedShift = sameSessionShifts.find((s) => s.employeeId === att.employeeId);
            if (!matchedShift && att.clockInActual) {
              const attTime = new Date(att.clockInActual).getTime();
              matchedShift = sameSessionShifts.find((s) => {
                const sIn = s.clockIn.getTime();
                const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
                return attTime >= sIn - 45 * 60 * 1000 && attTime <= sOut + 30 * 60 * 1000;
              });
            }
            if (!matchedShift) {
              matchedShift = sameSessionShifts[0];
            }
          } else if (!attSesi) {
            matchedShift = shiftsOnDate.find((s) => s.employeeId === att.employeeId);
            if (!matchedShift && att.clockInActual) {
              const attTime = new Date(att.clockInActual).getTime();
              matchedShift = shiftsOnDate.find((s) => {
                const sIn = s.clockIn.getTime();
                const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
                return attTime >= sIn - 30 * 60 * 1000 && attTime <= sOut + 30 * 60 * 1000;
              });
            }
            if (!matchedShift && shiftsOnDate.length === 1) {
              matchedShift = shiftsOnDate[0];
            }
          }
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
            roleTask: 'Kasir',
            verificationSource: 'LOGIN_AUTO',
            isSubstitute: false,
            notes: 'Peran: Kasir | Kasir Shift',
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
              slotStart: sesi === 'Siang' ? '11:30' : '07:30',
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
        const shiftAttPoints = shiftsOnDate.map((s) => {
          const group = shiftPoolMap.get(s.id)!;
          if (group.attendees.length === 0) return 0;
          return group.attendees.reduce((sum, att) => {
            const w = computePersonnelWeight({
              role: extractRoleFromNotes(att.notes, att.employee.jabatan),
              sesi: group.sesi,
              attendanceDate: d.date,
              lateMinutes: att.lateMinutes,
            });
            return sum + w.totalWeight;
          }, 0);
        });
        const totalAttPts = shiftAttPoints.reduce((a, b) => a + b, 0);
        const shiftLks = shiftsOnDate.map((s, idx) =>
          hasAnyAttendee && (shiftAttPoints[idx] ?? 0) === 0 ? 0 : Math.max(0, profitByShiftId.get(s.id) ?? 0),
        );
        const totalLk = shiftLks.reduce((a, b) => a + b, 0);

        // Rumus seragam 50% Kehadiran / 50% Laba Kotor (sama dengan /api/admin/laporan/per-shift)
        const shiftWeights = shiftsOnDate.map((_, idx) => {
          const attPts = shiftAttPoints[idx] ?? 0;
          const lk = shiftLks[idx] ?? 0;
          if (hasAnyAttendee && attPts === 0) return 0;
          return 0.5 * attPts * (totalLk > 0 ? totalLk : 1) + 0.5 * lk * (totalAttPts > 0 ? totalAttPts : 1);
        });
        const shiftShares = allocateProportional(poolHariIni, shiftWeights);

        shiftsOnDate.forEach((s, i) => {
          const group = shiftPoolMap.get(s.id)!;
          group.pool = shiftShares[i] ?? 0;

          const hari = dayOfDate(d.date);
          const gKey = `${hari}-${group.sesi}`;
          const gAgg = shiftGroupAggMap.get(gKey) ?? {
            groupKey: gKey,
            hari,
            sesi: group.sesi,
            totalShiftCount: 0,
            totalPoolShift: 0,
            memberNames: new Set<string>(),
          };
          gAgg.totalShiftCount += 1;
          gAgg.totalPoolShift += group.pool;

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
            gAgg.memberNames.add(att.employee.fullName);
            return { att, roleTask, wInfo };
          });

          shiftGroupAggMap.set(gKey, gAgg);

          // Mode PER_SHIFT: upah diberikan utuh per shift (nominal per nama = 0)
          evaluated.forEach(({ att, roleTask, wInfo }) => {
            attendeeNominalMap.set(att.id, {
              nominal: 0,
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
        evaluated.forEach(({ att, roleTask, wInfo }) => {
          attendeeNominalMap.set(att.id, {
            nominal: 0,
            roleTask,
            effectiveLate: wInfo.effectiveLateMinutes,
          });
          allDayAttendees.push(att);
        });
      }

      const count = allDayAttendees.length;

      const personnelDetails: WorkerDetail[] = allDayAttendees.map((att) => {
        const info = attendeeNominalMap.get(att.id);
        const roleTask = info?.roleTask ?? extractRoleFromNotes(att.notes, att.employee.jabatan);
        const effectiveLate = info?.effectiveLate ?? 0;

        const empId = att.employee.id;
        const displayJabatan =
          empId === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM
            ? 'Ketua UMKM / Admin Shift'
            : att.employee.jabatan;

        return {
          attendanceId: att.id,
          employeeId: att.employee.id,
          fullName: att.employee.fullName,
          nim: att.employee.nim,
          programStudi: att.employee.programStudi,
          jabatan: displayJabatan,
          roleTask,
          slotStart: att.schedule?.slotStart ?? '07:30',
          slotEnd: att.schedule?.slotEnd ?? '11:30',
          status: effectiveLate > 0 ? 'TELAT' : 'HADIR',
          clockInActual: att.clockInActual ? att.clockInActual.toISOString() : null,
          clockOutActual: att.clockOutActual ? att.clockOutActual.toISOString() : null,
          lateMinutes: effectiveLate,
          nominalBagiHasil: 0,
        };
      });

      dailyBreakdowns.push({
        date: d.date,
        omzet: d.omzet,
        labaKotor: d.labaKotor,
        biayaOperasional: d.biayaOperasional,
        poolBagiHasil: poolHariIni,
        personnelCount: count,
        nominalPerOrang: 0,
        personnel: personnelDetails,
      });
    }

    const summaryPerShiftGroup = Array.from(shiftGroupAggMap.values()).map((g) => ({
      groupKey: g.groupKey,
      hari: g.hari,
      sesi: g.sesi,
      totalShiftCount: g.totalShiftCount,
      totalPoolShift: g.totalPoolShift,
      anggotaTim: Array.from(g.memberNames).sort(),
    }));

    return apiOk({
      payrollMode: 'PER_SHIFT',
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
        totalKelompokShiftAktif: summaryPerShiftGroup.length,
        totalPersonelAktif: 0,
      },
      summaryPerShiftGroup,
      summaryPerEmployee: [],
      dailyBreakdowns,
    });
  } catch (err) {
    console.error('[bagi-hasil GET]', err);
    return apiError('Gagal menghitung alokasi bagi hasil karyawan.', 500);
  }
}
