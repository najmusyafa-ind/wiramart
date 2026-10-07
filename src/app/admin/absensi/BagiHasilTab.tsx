'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  DollarSign, Users, Award, TrendingUp, Calendar, Download,
  Loader2, CheckCircle2, ChevronDown, ChevronRight, ShieldCheck,
  ShoppingBag, HeartHandshake, Package, RefreshCw, AlertCircle
} from 'lucide-react';

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

type EmployeeSummary = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  totalHadir: number;
  totalMenitKerja: number;
  totalNominal: number;
};

type BagiHasilResponse = {
  range: {
    startDate: string;
    endDate: string;
    label: string;
    period?: string | null;
  };
  summary: {
    totalOmzet: number;
    totalLabaKotor: number;
    totalBiayaOperasional: number;
    totalAlokasiKaryawan: number;
    totalLabaBersihToko: number;
    totalPersonelAktif: number;
  };
  summaryPerEmployee: EmployeeSummary[];
  dailyBreakdowns: DailyDivision[];
};

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function BagiHasilTab() {
  const uid = useId();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const currentMonth = today.slice(0, 7);

  const [mode, setMode] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const [data, setData] = useState<BagiHasilResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = mode === 'daily'
        ? `/api/admin/bagi-hasil?date=${selectedDate}`
        : `/api/admin/bagi-hasil?month=${selectedMonth}`;
      const res = await fetch(url);
      const json = await res.json() as { success: boolean; data?: BagiHasilResponse; error?: string };
      if (!res.ok || !json.success || !json.data) {
        setError(json.error ?? 'Gagal memuat data bagi hasil.');
        return;
      }
      setData(json.data);
    } catch {
      setError('Koneksi jaringan terputus. Pastikan server aktif.');
    } finally {
      setLoading(false);
    }
  }, [mode, selectedDate, selectedMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleDate(dateStr: string) {
    setExpandedDates((prev) => ({ ...prev, [dateStr]: !prev[dateStr] }));
  }

  // Export Excel Slip Bagi Hasil
  async function handleExportExcel() {
    if (!data) return;
    setExportLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira — Wiramart UNPERBA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Rekap Bagi Hasil 50%');

      // Title header
      ws.mergeCells('A1:G1');
      const title = ws.getCell('A1');
      title.value = 'REKAPITULASI ALOKASI BAGI HASIL 50% KARYAWAN WIRAMART';
      title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 26;

      ws.mergeCells('A2:G2');
      const sub = ws.getCell('A2');
      sub.value = `Periode: ${data.range.label} | Total Pool Bagi Hasil: ${formatRupiah(data.summary.totalAlokasiKaryawan)}`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF374151' } };
      sub.alignment = { horizontal: 'center' };
      ws.getRow(2).height = 20;

      // Header row
      ws.columns = [
        { key: 'no',     width: 6 },
        { key: 'nama',   width: 28 },
        { key: 'nim',    width: 16 },
        { key: 'prodi',  width: 22 },
        { key: 'jabatan',width: 16 },
        { key: 'hadir',  width: 14 },
        { key: 'nominal',width: 22 },
      ];

      const hRow = ws.getRow(4);
      hRow.values = ['No', 'Nama Lengkap', 'NIM', 'Program Studi', 'Jabatan Utama', 'Shift Hadir', 'Hak Bagi Hasil (Rp)'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      hRow.height = 24;

      data.summaryPerEmployee.forEach((emp, idx) => {
        const row = ws.addRow({
          no:      idx + 1,
          nama:    emp.fullName,
          nim:     emp.nim,
          prodi:   emp.programStudi,
          jabatan: emp.jabatan,
          hadir:   `${emp.totalHadir} shift`,
          nominal: emp.totalNominal,
        });
        row.getCell('nominal').numFmt = '"Rp "#,##0';
        if (idx % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((c: any) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
        }
      });

      // Total row
      const totRow = ws.addRow({
        no:      '',
        nama:    'TOTAL DISTRIBUSI BAGI HASIL',
        nim:     '',
        prodi:   '',
        jabatan: '',
        hadir:   `${data.summary.totalPersonelAktif} Orang`,
        nominal: data.summary.totalAlokasiKaryawan,
      });
      totRow.getCell('nominal').numFmt = '"Rp "#,##0';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totRow.eachCell((c: any) => {
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      });

      // Tanda tangan
      ws.addRow([]);
      ws.addRow([]);
      const signRowIdx = ws.rowCount + 1;
      ws.getCell(`B${signRowIdx}`).value = 'Penerima / Perwakilan Shift,';
      ws.getCell(`F${signRowIdx}`).value = 'Mengetahui, Manager / Dosen';
      ws.getCell(`B${signRowIdx + 4}`).value = '( .............................................. )';
      ws.getCell(`F${signRowIdx + 4}`).value = '( .............................................. )';

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rekap-bagi-hasil-wiramart-${mode}-${selectedDate || selectedMonth}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Gagal mengekspor data Excel.');
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <div>
      {/* Toolbar & Filter */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-4)',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--color-surface-alt)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '2px',
              }}
            >
              <button
                type="button"
                onClick={() => setMode('daily')}
                className={`btn btn-sm ${mode === 'daily' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ border: 'none', padding: '5px 12px', fontSize: 'var(--text-xs)' }}
              >
                Harian (Per Tanggal)
              </button>
              <button
                type="button"
                onClick={() => setMode('monthly')}
                className={`btn btn-sm ${mode === 'monthly' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ border: 'none', padding: '5px 12px', fontSize: 'var(--text-xs)' }}
              >
                Bulanan (Rekap Honor)
              </button>
            </div>

            {mode === 'daily' ? (
              <input
                id={`${uid}-date`}
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="form-input"
                style={{ minHeight: 34, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
              />
            ) : (
              <input
                id={`${uid}-month`}
                type="month"
                value={selectedMonth}
                max={currentMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="form-input"
                style={{ minHeight: 34, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
              />
            )}
          </div>

          {/* Action Export */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleExportExcel}
              disabled={!data || exportLoading}
              className="btn btn-primary btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'hsl(142 71% 35%)',
                borderColor: 'hsl(142 71% 30%)',
                fontWeight: 700,
              }}
            >
              {exportLoading ? (
                <><Loader2 size={13} className="spin-icon" /> Mengunduh...</>
              ) : (
                <><Download size={13} /> 📊 Unduh Slip Bagi Hasil (.xlsx)</>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: 12,
            backgroundColor: 'var(--color-error-light)', border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
            color: 'var(--color-error)', fontSize: 'var(--text-xs)',
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto var(--space-2)' }} />
          <p style={{ fontSize: 'var(--text-sm)' }}>Menghitung alokasi bagi hasil 50% karyawan...</p>
        </div>
      ) : !data ? null : (
        <>
          {/* Executive KPI Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-5)',
            }}
          >
            {/* Pool Bagi Hasil 50% */}
            <div
              className="card"
              style={{
                padding: 'var(--space-4)',
                borderLeft: '4px solid hsl(142 71% 45%)',
                backgroundColor: 'hsl(142 76% 97%)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'hsl(142 76% 25%)' }}>
                  POOL BAGI HASIL (50% PATEN)
                </span>
                <Award size={18} style={{ color: 'hsl(142 71% 40%)' }} />
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'hsl(142 76% 20%)' }}>
                {formatRupiah(data.summary.totalAlokasiKaryawan)}
              </div>
              <div style={{ fontSize: '11px', color: 'hsl(142 76% 35%)', marginTop: 4 }}>
                Alokasi hak gaji 4 orang tim shift
              </div>
            </div>

            {/* Total Laba Kotor Toko */}
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Total Laba Kotor
                </span>
                <TrendingUp size={18} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)' }}>
                {formatRupiah(data.summary.totalLabaKotor)}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Omzet: {formatRupiah(data.summary.totalOmzet)}
              </div>
            </div>

            {/* Total Personel Hadir */}
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Penerima Bagi Hasil
                </span>
                <Users size={18} style={{ color: 'var(--color-info)' }} />
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)' }}>
                {data.summary.totalPersonelAktif} Mahasiswa
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {mode === 'daily'
                  ? `Rata-rata: ${formatRupiah(data.summary.totalPersonelAktif > 0 ? Math.floor(data.summary.totalAlokasiKaryawan / data.summary.totalPersonelAktif) : 0)} / orang`
                  : 'Total staf aktif di shift bulan ini'}
              </div>
            </div>

            {/* Laba Bersih Toko */}
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Laba Bersih Toko (Wiramart)
                </span>
                <DollarSign size={18} style={{ color: 'var(--color-success)' }} />
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>
                {formatRupiah(data.summary.totalLabaBersihToko)}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Setelah potong bagi hasil & biaya
              </div>
            </div>
          </div>

          {/* Tabel Rekapitulasi per Mahasiswa */}
          <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                  Rincian Hak Bagi Hasil per Mahasiswa ({data.range.label})
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                  Dihitung otomatis dari alokasi 50% laba per hari dibagi rata ke tim shift yang bertugas
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>No</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>Nama Mahasiswa</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>NIM & Prodi</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left' }}>Jabatan</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Shift Hadir</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Total Hak Bagi Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summaryPerEmployee.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                        Tidak ada data kehadiran presensi pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    data.summaryPerEmployee.map((emp, idx) => (
                      <tr key={emp.employeeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{emp.fullName}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--color-text-muted)' }}>
                          <div>{emp.nim}</div>
                          <div style={{ fontSize: 10 }}>{emp.programStudi}</div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span
                            style={{
                              padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                              backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)',
                            }}
                          >
                            {emp.jabatan}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                          {emp.totalHadir} shift
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: 'hsl(142 71% 35%)', fontSize: 'var(--text-sm)' }}>
                          {formatRupiah(emp.totalNominal)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Breakdown Rincian Harian (Jika Mode Bulanan) */}
          {mode === 'monthly' && data.dailyBreakdowns.length > 0 && (
            <div className="card">
              <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                  Jurnal Harian Bagi Hasil Shift Toko
                </h3>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
                  Klik pada tiap tanggal untuk melihat rincian 4 personel yang hadir dan nominal yang diterima
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.dailyBreakdowns.map((d) => {
                  const isExp = expandedDates[d.date];
                  const hasPool = d.poolBagiHasil > 0;
                  return (
                    <div key={d.date} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <div
                        onClick={() => toggleDate(d.date)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          cursor: 'pointer',
                          backgroundColor: isExp ? 'var(--color-surface-muted)' : 'white',
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {isExp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 'var(--text-xs)' }}>
                              {new Date(d.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                              Omzet: {formatRupiah(d.omzet)} | Laba Kotor: {formatRupiah(d.labaKotor)}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, color: hasPool ? 'hsl(142 71% 35%)' : 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                            Pool: {formatRupiah(d.poolBagiHasil)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                            {d.personnelCount} orang bertugas ({formatRupiah(d.nominalPerOrang)}/org)
                          </div>
                        </div>
                      </div>

                      {/* Detail Personel yang bertugas */}
                      {isExp && (
                        <div style={{ padding: '10px 16px 14px 40px', backgroundColor: 'var(--color-surface-muted)' }}>
                          {d.personnel.length === 0 ? (
                            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
                              Tidak ada absensi tercatat pada hari ini.
                            </p>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                              {d.personnel.map((p) => (
                                <div
                                  key={p.attendanceId}
                                  style={{
                                    backgroundColor: 'white',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '8px 12px',
                                    border: '1px solid var(--color-border)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 11 }}>{p.fullName}</div>
                                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                                      Peran: <strong>{p.roleTask}</strong> ({p.slotStart}–{p.slotEnd})
                                    </div>
                                  </div>
                                  <div style={{ fontWeight: 800, color: 'hsl(142 71% 35%)', fontSize: 11 }}>
                                    {formatRupiah(p.nominalBagiHasil)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
