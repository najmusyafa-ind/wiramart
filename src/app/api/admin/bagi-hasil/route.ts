// =============================================================
// GET /api/admin/bagi-hasil
// Endpoint untuk menghitung Alokasi Bagi Hasil 50% Karyawan (Paten Wiramart)
// Membagi porsi laba secara adil kepada anggota shift yang hadir/presensi
// Auth: sk_admin
// =============================================================

import { NextRequest } from 'next/server';
import { and, gte, lte, inArray, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { resolveReportRange, getFinancialReport, type PeriodKey } from '@/lib/finance/report';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Khusus Admin/Manager.', 403);
  }

  const { searchParams } = new URL(req.url);
  const periodParam = searchParams.get('period') as PeriodKey | null;
  const dateFromParam = searchParams.get('dateFrom') || searchParams.get('startDate') || searchParams.get('date');
  const dateToParam = searchParams.get('dateTo') || searchParams.get('endDate') || searchParams.get('date');
  const monthParam = searchParams.get('month'); // 'YYYY-MM'

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
      const nominalPerOrang = count > 0 ? Math.floor(poolHariIni / count) : 0;

      const personnelDetails: WorkerDetail[] = attendees.map((att) => {
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
        nominalPerOrang,
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
