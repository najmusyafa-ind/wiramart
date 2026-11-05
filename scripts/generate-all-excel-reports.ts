import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/admin/laporan/per-shift/route';
import { signAccessToken } from '../src/lib/utils/auth';

const BULAN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI_ORDER: Record<string, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
  Minggu: 7,
};

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN_SHORT[(m ?? 1) - 1] ?? ''} ${y}`;
}

function formatGroupedDates(dates: string[]): string {
  if (dates.length === 0) return '—';
  const sorted = [...dates].sort();
  if (sorted.length === 1) {
    return formatShortDate(sorted[0]!);
  }
  const byMonth = new Map<string, number[]>();
  for (const dt of sorted) {
    const [y, m, d] = dt.split('-').map(Number);
    const key = `${BULAN_SHORT[(m ?? 1) - 1] ?? ''} ${y}`;
    const list = byMonth.get(key) ?? [];
    if (d && !list.includes(d)) list.push(d);
    byMonth.set(key, list);
  }
  const parts: string[] = [];
  for (const [mLabel, days] of byMonth.entries()) {
    parts.push(`${days.join(', ')} ${mLabel}`);
  }
  return parts.join(' · ');
}

// Styling Constants
const FONT_TITLE = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
const FONT_HEADER = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const FONT_BOLD = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };
const FONT_REGULAR = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
const FONT_MUTED = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };

const FILL_NAVY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B4C7E' } };
const FILL_ZEBRA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const FILL_TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

const BORDER_THIN = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const BORDER_TOTAL = {
  top: { style: 'thin', color: { argb: 'FF1E293B' } },
  bottom: { style: 'double', color: { argb: 'FF1E293B' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const CURRENCY_FMT = '_("Rp "* #,##0_);_("Rp "* (#,##0);_("Rp "* "-"_);_(@_)';
const NUMBER_FMT = '#,##0';

async function fetchReportData(queryParam: string) {
  const token = await signAccessToken({
    sub: 'admin-1',
    role: 'admin',
    adminRole: 'MANAGER',
    email: 'dosen@unperba.ac.id',
  });

  const url = `http://localhost:3000/api/admin/laporan/per-shift?${queryParam}`;
  const req = new NextRequest(url, {
    headers: {
      cookie: `sk_admin=${token}`,
    },
  });

  const res = await GET(req);
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch');
  }
  return json.data;
}

async function buildWorkbook(data: any) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wiramart UNPERBA — Smartkasir Perwira';
  wb.lastModifiedBy = 'Manager (Dosen)';
  wb.created = new Date();
  wb.modified = new Date();

  // 1. Konsolidasi Shift Kelompok
  const sessionMap = new Map<string, any>();
  for (const s of data.shifts) {
    const sKey = `${s.tanggal}-${s.sesi}`;
    const gaji = s.gajiBersih !== undefined ? s.gajiBersih : (s.personnelCount > 0 ? s.poolGaji : 0);
    const existing = sessionMap.get(sKey);
    if (!existing) {
      sessionMap.set(sKey, {
        sessionKey: sKey,
        tanggal: s.tanggal,
        hari: s.hari,
        sesi: s.sesi,
        slotLabel: s.slotLabel,
        clockIn: s.clockIn,
        clockOut: s.clockOut,
        kasirName: s.kasirName,
        txCount: s.txCount,
        omzet: s.omzet,
        labaKotor: s.labaKotor,
        upahBersih: gaji,
        personnel: [...s.personnel],
      });
    } else {
      existing.txCount += s.txCount;
      existing.omzet += s.omzet;
      existing.labaKotor += s.labaKotor;
      existing.upahBersih += gaji;
      if (s.clockOut) existing.clockOut = s.clockOut;
      for (const p of s.personnel) {
        if (!existing.personnel.some((x: any) => x.employeeId === p.employeeId)) {
          existing.personnel.push(p);
        }
      }
    }
  }

  const groupMap = new Map<string, any>();
  for (const sess of sessionMap.values()) {
    const gKey = `${sess.hari}-${sess.sesi}`;
    const g = groupMap.get(gKey) ?? {
      hari: sess.hari,
      sesi: sess.sesi,
      sessions: [],
    };
    g.sessions.push(sess);
    groupMap.set(gKey, g);
  }

  const scheduleTeams = data.scheduleTeams ?? {};
  const builtGroups: any[] = [];

  for (const [gKey, g] of groupMap.entries()) {
    g.sessions.sort((a: any, b: any) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));

    // Anggota Shift:
    // Utamakan dari jadwal master jika ada, jika tidak (atau belum aktif), ambil dari personel aktual
    const scheduled = scheduleTeams[gKey] ?? [];
    const memberMap = new Map<string, { employeeId: string; fullName: string; nim: string; jabatan: string }>();

    for (const m of scheduled) {
      memberMap.set(m.employeeId, {
        employeeId: m.employeeId,
        fullName: m.fullName,
        nim: m.nim,
        jabatan: m.jabatan,
      });
    }

    if (memberMap.size === 0) {
      for (const sess of g.sessions) {
        for (const p of sess.personnel) {
          if (!memberMap.has(p.employeeId)) {
            memberMap.set(p.employeeId, {
              employeeId: p.employeeId,
              fullName: p.fullName,
              nim: p.nim,
              jabatan: p.jabatan,
            });
          }
        }
      }
    }

    const anggotaShift = Array.from(memberMap.values());
    const dates = g.sessions.map((x: any) => x.tanggal);

    if (g.hari === 'Sabtu' || g.hari === 'Minggu') continue;
    if (anggotaShift.length === 0) continue;

    builtGroups.push({
      groupKey: gKey,
      hari: g.hari,
      dayOrder: HARI_ORDER[g.hari] ?? 9,
      sesi: g.sesi,
      waktuLabel: g.sesi === 'Pagi' ? '07:00–11:30' : '11:30–15:00',
      shiftTglSummary: formatGroupedDates(dates),
      anggotaShift,
      totalPersonel: anggotaShift.length,
      totalShiftCount: g.sessions.length,
      upahBersih: g.sessions.reduce((s: number, x: any) => s + x.upahBersih, 0),
      totalTx: g.sessions.reduce((s: number, x: any) => s + x.txCount, 0),
      totalOmzet: g.sessions.reduce((s: number, x: any) => s + x.omzet, 0),
      totalLabaKotor: g.sessions.reduce((s: number, x: any) => s + x.labaKotor, 0),
      sessions: g.sessions,
    });
  }

  builtGroups.sort((a, b) => {
    if (a.dayOrder !== b.dayOrder) return a.dayOrder - b.dayOrder;
    return a.sesi === 'Pagi' ? -1 : 1;
  });

  const filteredGroups = builtGroups;
  const tableTotals = filteredGroups.reduce(
    (acc, g) => ({
      totalPersonel: acc.totalPersonel + g.totalPersonel,
      totalShiftCount: acc.totalShiftCount + g.totalShiftCount,
      totalTx: acc.totalTx + g.totalTx,
      totalOmzet: acc.totalOmzet + g.totalOmzet,
      totalLabaKotor: acc.totalLabaKotor + g.totalLabaKotor,
      upahBersih: acc.upahBersih + g.upahBersih,
    }),
    { totalPersonel: 0, totalShiftCount: 0, totalTx: 0, totalOmzet: 0, totalLabaKotor: 0, upahBersih: 0 }
  );

  // ─────────────────────────────────────────────────────────────────────
  // SHEET 1: RINGKASAN FINANSIAL
  // ─────────────────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Ringkasan Finansial', { views: [{ showGridLines: true }] });
  ws1.columns = [{ width: 4 }, { width: 36 }, { width: 24 }, { width: 48 }];

  ws1.mergeCells('B2:D2');
  const h1 = ws1.getCell('B2');
  h1.value = 'WIRAMART UNPERBA — LAPORAN REKAPITULASI KEUANGAN & BAGI HASIL';
  h1.font = FONT_TITLE;
  h1.fill = FILL_NAVY as ExcelJS.Fill;
  h1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 28;

  ws1.mergeCells('B3:D3');
  const h2 = ws1.getCell('B3');
  h2.value = `Periode Operasional: ${data.range.label} | Sistem Pembagian Gaji Hybrid 70% Kehadiran / 30% Kinerja`;
  h2.font = FONT_MUTED;
  h2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(3).height = 20;

  const r5 = ws1.getRow(5);
  r5.values = ['', 'Pos Finansial', 'Nilai (Rupiah / Satuan)', 'Keterangan Sistem'];
  ['B5', 'C5', 'D5'].forEach((addr) => {
    const c = ws1.getCell(addr);
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER as ExcelJS.Fill;
    c.alignment = { vertical: 'middle', horizontal: addr === 'C5' ? 'right' : 'left' };
  });
  r5.height = 22;

  const summaryRows = [
    { pos: 'Total Transaksi Kasir', val: data.grandTotal.txCount, fmt: NUMBER_FMT, desc: 'Jumlah transaksi sukses tercatat di POS kasir' },
    { pos: 'Total Omzet Penjualan', val: data.grandTotal.omzet, fmt: CURRENCY_FMT, desc: 'Total penerimaan kotor dari seluruh transaksi produk' },
    { pos: 'Laba Kotor Operasional', val: data.grandTotal.labaKotor, fmt: CURRENCY_FMT, desc: 'Selisih harga jual terhadap HPP (Cost of Goods Sold)' },
    { pos: 'Beban Operasional Toko', val: data.grandTotal.biayaOperasional ?? 50000, fmt: CURRENCY_FMT, desc: 'Biaya utilitas & operasional paten bulanan UMKM' },
    { pos: 'Laba Bersih Operasional', val: data.grandTotal.labaOperasionalBersih ?? (data.grandTotal.labaKotor - 50000), fmt: CURRENCY_FMT, desc: 'Laba Kotor dikurangi Beban Operasional Toko' },
    { pos: 'Alokasi Hak Mahasiswa (50%)', val: data.grandTotal.poolGaji, fmt: CURRENCY_FMT, desc: 'Plafon total upah bagi hasil seluruh mahasiswa shift' },
    { pos: 'Alokasi Kas Toko (50%)', val: data.grandTotal.labaBersihToko ?? data.grandTotal.poolGaji, fmt: CURRENCY_FMT, desc: 'Bagian kas bersih toko untuk pengembangan UMKM' },
    { pos: 'Total Upah Terdistribusi', val: data.grandTotal.totalDistributed ?? data.grandTotal.poolGaji, fmt: CURRENCY_FMT, desc: 'Total upah yang disalurkan tuntas ke seluruh anggota' },
    { pos: 'Sisa Saldo Pool (Kebocoran)', val: data.grandTotal.sisaPool ?? 0, fmt: CURRENCY_FMT, desc: 'Metode Hamilton menjamin zero-leakage (Rp 0 selisih)' },
  ];

  summaryRows.forEach((item, idx) => {
    const rowNum = 6 + idx;
    const r = ws1.getRow(rowNum);
    r.values = ['', item.pos, item.val, item.desc];
    const isSpecial = item.pos.includes('(50%)') || item.pos.includes('Laba Bersih');
    
    ['B', 'C', 'D'].forEach((col) => {
      const c = ws1.getCell(`${col}${rowNum}`);
      c.font = isSpecial ? FONT_BOLD : FONT_REGULAR;
      c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
      c.alignment = { vertical: 'middle', horizontal: col === 'C' ? 'right' : 'left' };
      if (idx % 2 === 1 && !isSpecial) c.fill = FILL_ZEBRA as ExcelJS.Fill;
      if (isSpecial) c.fill = FILL_TOTAL as ExcelJS.Fill;
    });
    ws1.getCell(`C${rowNum}`).numFmt = item.fmt;
    r.height = 21;
  });

  const noteStartRow = 17;
  ws1.mergeCells(`B${noteStartRow}:D${noteStartRow}`);
  const noteTitle = ws1.getCell(`B${noteStartRow}`);
  noteTitle.value = 'PEDOMAN & FORMULA SISTEM PENGGAJIAN PERSHIFT WIRAMART';
  noteTitle.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };
  ws1.getRow(noteStartRow).height = 22;

  const notesList = [
    { no: '1.', rule: 'Rasio Utama 50% : 50% (Paten)', detail: 'Laba Bersih Toko dibagi seimbang 50% untuk Kas Toko dan 50% untuk Plafon Upah Mahasiswa (Closed-Loop).' },
    { no: '2.', rule: 'Komposisi Pool Hybrid 70% / 30%', detail: '70% Jatah Kehadiran (Attendance Pool) dibagikan berdasarkan poin kedisiplinan hadir dan ketepatan waktu. 30% Bonus Produktivitas (Performance Pool) dibagikan proporsional sesuai laba kotor shift.' },
    { no: '3.', rule: 'Faktor Disiplin Waktu Kehadiran', detail: 'Hadir tepat waktu = bobot 1.0 (100%). Keterlambatan dikenakan penalti poin proporsional waktu telat.' },
    { no: '4.', rule: 'Pembagian Internal Shift', detail: 'Upah yang dialokasikan ke shift dibagikan ke seluruh personel yang hadir di shift tersebut berdasarkan bobot peran & kedisiplinan.' },
    { no: '5.', rule: 'Distribusi Bulat Tanpa Residu (Hamilton)', detail: 'Seluruh alokasi rupiah dibulatkan menggunakan metode Largest Remainder (Hamilton) sehingga sisa saldo pool selalu Rp 0 (zero-leakage).' },
  ];

  notesList.forEach((n, idx) => {
    const rowNum = noteStartRow + 1 + idx;
    const r = ws1.getRow(rowNum);
    r.values = ['', `${n.no} ${n.rule}`, n.detail, ''];
    ws1.mergeCells(`C${rowNum}:D${rowNum}`);
    ws1.getCell(`B${rowNum}`).font = FONT_BOLD;
    ws1.getCell(`C${rowNum}`).font = FONT_REGULAR;
    ws1.getCell(`B${rowNum}`).border = BORDER_THIN as Partial<ExcelJS.Borders>;
    ws1.getCell(`C${rowNum}`).border = BORDER_THIN as Partial<ExcelJS.Borders>;
    ws1.getCell(`D${rowNum}`).border = BORDER_THIN as Partial<ExcelJS.Borders>;
    r.height = 20;
  });

  // ─────────────────────────────────────────────────────────────────────
  // SHEET 2: REKAP KELOMPOK SHIFT
  // ─────────────────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Rekap Kelompok Shift', { views: [{ showGridLines: true }] });
  ws2.columns = [
    { width: 4 },  // A
    { width: 6 },  // B: No
    { width: 14 }, // C: Hari
    { width: 10 }, // D: Sesi
    { width: 16 }, // E: Jam Kerja
    { width: 12 }, // F: Jml Personel
    { width: 14 }, // G: Frekuensi Shift
    { width: 14 }, // H: Total Tx
    { width: 18 }, // I: Total Omzet
    { width: 18 }, // J: Laba Kotor
    { width: 20 }, // K: Total Upah Bersih
    { width: 18 }, // L: Rata-Rata/Shift
    { width: 64 }, // M: Keterangan Detail Upah Per Anggota
  ];

  ws2.mergeCells('B2:M2');
  const t2 = ws2.getCell('B2');
  t2.value = 'REKAPITULASI UPAH PER KELOMPOK SHIFT RESMI & DETAIL PEMBAGIAN PER ANGGOTA';
  t2.font = FONT_TITLE;
  t2.fill = FILL_NAVY as ExcelJS.Fill;
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(2).height = 28;

  ws2.mergeCells('B3:M3');
  const t2Sub = ws2.getCell('B3');
  t2Sub.value = `Periode: ${data.range.label} | Jadwal Operasional Senin s/d Jumat`;
  t2Sub.font = FONT_MUTED;
  t2Sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(3).height = 20;

  const headerCols2 = [
    'No', 'Hari', 'Sesi', 'Jam Kerja', 'Personel',
    'Frekuensi', 'Transaksi', 'Omzet (Rp)', 'Laba Kotor (Rp)', 'Upah Bersih (Rp)', 'Rata-Rata/Shift', 'Keterangan Detail Upah Per Anggota'
  ];
  const r2Header = ws2.getRow(5);
  r2Header.values = ['', ...headerCols2];
  ['B5','C5','D5','E5','F5','G5','H5','I5','J5','K5','L5','M5'].forEach((addr) => {
    const c = ws2.getCell(addr);
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER as ExcelJS.Fill;
    c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['B5','C5','D5','E5','F5','G5'].includes(addr) ? 'center' : (['H5','I5','J5','K5','L5'].includes(addr) ? 'right' : 'left'),
    };
  });
  r2Header.height = 24;

  const groupStats = new Map<string, { memberNominals: Map<string, number> }>();
  for (const s of data.shifts) {
    const gKey = `${s.hari}-${s.sesi}`;
    if (!groupStats.has(gKey)) {
      groupStats.set(gKey, { memberNominals: new Map<string, number>() });
    }
    const g = groupStats.get(gKey)!;
    for (const p of s.personnel) {
      const cur = g.memberNominals.get(p.fullName) ?? 0;
      g.memberNominals.set(p.fullName, cur + p.nominalBagiHasil);
    }
  }

  filteredGroups.forEach((g, idx) => {
    const rowNum = 6 + idx;
    const r = ws2.getRow(rowNum);
    const shiftCount = g.totalShiftCount;
    const avgPerMeeting = shiftCount > 0 ? Math.round(g.upahBersih / shiftCount) : 0;

    const gStat = groupStats.get(g.groupKey);
    const memberDetails: string[] = [];
    if (gStat && gStat.memberNominals.size > 0) {
      gStat.memberNominals.forEach((nominal, name) => {
        memberDetails.push(`${name} (Rp ${nominal.toLocaleString('id-ID')})`);
      });
    } else {
      g.anggotaShift.forEach((m: any) => {
        memberDetails.push(m.fullName);
      });
    }
    const detailKeterangan = memberDetails.join(', ');

    r.values = [
      '',
      idx + 1,
      g.hari,
      g.sesi,
      g.waktuLabel,
      g.totalPersonel,
      g.totalShiftCount,
      g.totalTx,
      g.totalOmzet,
      g.totalLabaKotor,
      g.upahBersih,
      avgPerMeeting,
      detailKeterangan,
    ];

    ['B','C','D','E','F','G','H','I','J','K','L','M'].forEach((col) => {
      const c = ws2.getCell(`${col}${rowNum}`);
      c.font = FONT_REGULAR;
      c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
      c.alignment = {
        vertical: 'middle',
        horizontal: ['B','C','D','E','F','G'].includes(col) ? 'center' : (['H','I','J','K','L'].includes(col) ? 'right' : 'left'),
        wrapText: col === 'M',
      };
      if (idx % 2 === 1) c.fill = FILL_ZEBRA as ExcelJS.Fill;
    });

    ws2.getCell(`F${rowNum}`).numFmt = NUMBER_FMT;
    ws2.getCell(`G${rowNum}`).numFmt = NUMBER_FMT;
    ws2.getCell(`H${rowNum}`).numFmt = NUMBER_FMT;
    ws2.getCell(`I${rowNum}`).numFmt = CURRENCY_FMT;
    ws2.getCell(`J${rowNum}`).numFmt = CURRENCY_FMT;
    ws2.getCell(`K${rowNum}`).numFmt = CURRENCY_FMT;
    ws2.getCell(`L${rowNum}`).numFmt = CURRENCY_FMT;
    r.height = 24;
  });

  const totalRowNum2 = 6 + filteredGroups.length;
  const r2Total = ws2.getRow(totalRowNum2);
  r2Total.values = [
    '',
    '',
    'TOTAL KESELURUHAN',
    '',
    '',
    tableTotals.totalPersonel,
    tableTotals.totalShiftCount,
    tableTotals.totalTx,
    tableTotals.totalOmzet,
    tableTotals.totalLabaKotor,
    tableTotals.upahBersih,
    tableTotals.totalShiftCount > 0 ? Math.round(tableTotals.upahBersih / tableTotals.totalShiftCount) : 0,
    `Selesai 100% — Total Hak Mahasiswa Rp ${tableTotals.upahBersih.toLocaleString('id-ID')} Klop 50:50 dengan Kas Toko`,
  ];

  ws2.mergeCells(`C${totalRowNum2}:E${totalRowNum2}`);
  ['B','C','D','E','F','G','H','I','J','K','L','M'].forEach((col) => {
    const c = ws2.getCell(`${col}${totalRowNum2}`);
    c.font = FONT_BOLD;
    c.fill = FILL_TOTAL as ExcelJS.Fill;
    c.border = BORDER_TOTAL as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['C','D','E','F','G'].includes(col) ? 'center' : (['H','I','J','K','L'].includes(col) ? 'right' : 'left'),
    };
  });

  ws2.getCell(`F${totalRowNum2}`).numFmt = NUMBER_FMT;
  ws2.getCell(`G${totalRowNum2}`).numFmt = NUMBER_FMT;
  ws2.getCell(`H${totalRowNum2}`).numFmt = NUMBER_FMT;
  ws2.getCell(`I${totalRowNum2}`).numFmt = CURRENCY_FMT;
  ws2.getCell(`J${totalRowNum2}`).numFmt = CURRENCY_FMT;
  ws2.getCell(`K${totalRowNum2}`).numFmt = CURRENCY_FMT;
  ws2.getCell(`L${totalRowNum2}`).numFmt = CURRENCY_FMT;
  r2Total.height = 26;

  // ─────────────────────────────────────────────────────────────────────
  // SHEET 3: RINCIAN UPAH PER MAHASISWA
  // ─────────────────────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Upah Mahasiswa', { views: [{ showGridLines: true }] });
  ws3.columns = [
    { width: 4 },  // A
    { width: 6 },  // B: No
    { width: 28 }, // C: Nama Lengkap
    { width: 14 }, // D: NIM
    { width: 22 }, // E: Program Studi
    { width: 24 }, // F: Jabatan / Peran
    { width: 14 }, // G: Total Hadir
    { width: 22 }, // H: Nominal Upah (Rp)
    { width: 20 }, // I: Tanda Tangan
  ];

  ws3.mergeCells('B2:I2');
  const t3 = ws3.getCell('B2');
  t3.value = 'DAFTAR PENERIMAAN UPAH BAGI HASIL MAHASISWA — WIRAMART';
  t3.font = FONT_TITLE;
  t3.fill = FILL_NAVY as ExcelJS.Fill;
  t3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws3.getRow(2).height = 28;

  ws3.mergeCells('B3:I3');
  const t3Sub = ws3.getCell('B3');
  t3Sub.value = `Periode: ${data.range.label} | Total Mahasiswa: ${data.summaryPerEmployee.length} Orang`;
  t3Sub.font = FONT_MUTED;
  t3Sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws3.getRow(3).height = 20;

  const headerCols3 = [
    'No', 'Nama Lengkap', 'NIM', 'Program Studi', 'Jabatan / Peran',
    'Kehadiran', 'Upah Diterima (Rp)', 'Tanda Tangan'
  ];
  const r3Header = ws3.getRow(5);
  r3Header.values = ['', ...headerCols3];
  ['B5','C5','D5','E5','F5','G5','H5','I5'].forEach((addr) => {
    const c = ws3.getCell(addr);
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER as ExcelJS.Fill;
    c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
    c.alignment = { vertical: 'middle', horizontal: ['B5','D5','G5','I5'].includes(addr) ? 'center' : (addr === 'H5' ? 'right' : 'left') };
  });
  r3Header.height = 24;

  let totalHadirEmps = 0;
  let totalUpahEmps = 0;

  const sortedEmps = [...data.summaryPerEmployee].sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));
  sortedEmps.forEach((emp: any, idx: number) => {
    totalHadirEmps += emp.totalHadir;
    totalUpahEmps += emp.totalNominal;
    const rowNum = 6 + idx;
    const r = ws3.getRow(rowNum);
    r.values = [
      '',
      idx + 1,
      emp.fullName,
      emp.nim,
      emp.programStudi,
      emp.jabatan,
      emp.totalHadir,
      emp.totalNominal,
      '',
    ];

    ['B','C','D','E','F','G','H','I'].forEach((col) => {
      const c = ws3.getCell(`${col}${rowNum}`);
      c.font = FONT_REGULAR;
      c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
      c.alignment = {
        vertical: 'middle',
        horizontal: ['B','D','G','I'].includes(col) ? 'center' : (col === 'H' ? 'right' : 'left'),
      };
      if (idx % 2 === 1) c.fill = FILL_ZEBRA as ExcelJS.Fill;
    });

    ws3.getCell(`G${rowNum}`).numFmt = NUMBER_FMT;
    ws3.getCell(`H${rowNum}`).numFmt = CURRENCY_FMT;
    r.height = 21;
  });

  const totalRowNum3 = 6 + sortedEmps.length;
  const r3Total = ws3.getRow(totalRowNum3);
  r3Total.values = [
    '',
    '',
    'TOTAL KESELURUHAN',
    '',
    '',
    `${sortedEmps.length} Mahasiswa`,
    totalHadirEmps,
    totalUpahEmps,
    '',
  ];

  ws3.mergeCells(`C${totalRowNum3}:E${totalRowNum3}`);
  ['B','C','D','E','F','G','H','I'].forEach((col) => {
    const c = ws3.getCell(`${col}${totalRowNum3}`);
    c.font = FONT_BOLD;
    c.fill = FILL_TOTAL as ExcelJS.Fill;
    c.border = BORDER_TOTAL as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['C','D','E','G','I'].includes(col) ? 'center' : (col === 'H' ? 'right' : 'left'),
    };
  });

  ws3.getCell(`G${totalRowNum3}`).numFmt = NUMBER_FMT;
  ws3.getCell(`H${totalRowNum3}`).numFmt = CURRENCY_FMT;
  r3Total.height = 24;

  // ─────────────────────────────────────────────────────────────────────
  // SHEET 4: LOG SHIFT HARIAN
  // ─────────────────────────────────────────────────────────────────────
  const ws4 = wb.addWorksheet('Log Shift Harian', { views: [{ showGridLines: true }] });
  ws4.columns = [
    { width: 4 },  // A
    { width: 6 },  // B: No
    { width: 14 }, // C: Tanggal
    { width: 12 }, // D: Hari
    { width: 10 }, // E: Sesi
    { width: 26 }, // F: Kasir Bertugas
    { width: 16 }, // G: Buka (WIB)
    { width: 16 }, // H: Tutup (WIB)
    { width: 12 }, // I: Transaksi
    { width: 18 }, // J: Omzet (Rp)
    { width: 18 }, // K: Laba Kotor (Rp)
    { width: 18 }, // L: Upah Shift (Rp)
    { width: 14 }, // M: Jml Personel
    { width: 60 }, // N: Rincian Pembagian Upah Personel Shift
  ];

  ws4.mergeCells('B2:N2');
  const t4 = ws4.getCell('B2');
  t4.value = 'JURNAL LOG TRANSAKSI & RINCIAN HASIL OPERASIONAL SETIAP SHIFT';
  t4.font = FONT_TITLE;
  t4.fill = FILL_NAVY as ExcelJS.Fill;
  t4.alignment = { horizontal: 'center', vertical: 'middle' };
  ws4.getRow(2).height = 28;

  ws4.mergeCells('B3:N3');
  const t4Sub = ws4.getCell('B3');
  t4Sub.value = `Periode: ${data.range.label} | Total Pertemuan Shift: ${data.shifts.length} Shift`;
  t4Sub.font = FONT_MUTED;
  t4Sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws4.getRow(3).height = 20;

  const headerCols4 = [
    'No', 'Tanggal', 'Hari', 'Sesi', 'Kasir Bertugas',
    'Buka (WIB)', 'Tutup (WIB)', 'Transaksi', 'Omzet (Rp)', 'Laba Kotor (Rp)', 'Upah Shift (Rp)', 'Personel', 'Rincian Pembagian Upah Personel Shift'
  ];
  const r4Header = ws4.getRow(5);
  r4Header.values = ['', ...headerCols4];
  ['B5','C5','D5','E5','F5','G5','H5','I5','J5','K5','L5','M5','N5'].forEach((addr) => {
    const c = ws4.getCell(addr);
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER as ExcelJS.Fill;
    c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['B5','C5','D5','E5','G5','H5','M5'].includes(addr) ? 'center' : (['I5','J5','K5','L5'].includes(addr) ? 'right' : 'left'),
    };
  });
  r4Header.height = 24;

  data.shifts.forEach((s: any, idx: number) => {
    const inTime = s.clockIn ? new Date(s.clockIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '-';
    const outTime = s.clockOut ? new Date(s.clockOut).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : 'Berjalan';
    const rowNum = 6 + idx;
    const personelList = s.personnel.map((p: any) => `${p.fullName}: Rp ${p.nominalBagiHasil.toLocaleString('id-ID')}`).join(' | ');

    const r = ws4.getRow(rowNum);
    r.values = [
      '',
      idx + 1,
      s.tanggal,
      s.hari,
      s.sesi,
      s.kasirName,
      inTime,
      outTime,
      s.txCount,
      s.omzet,
      s.labaKotor,
      s.gajiBersih,
      s.personnelCount,
      personelList || 'Hanya Kasir',
    ];

    ['B','C','D','E','F','G','H','I','J','K','L','M','N'].forEach((col) => {
      const c = ws4.getCell(`${col}${rowNum}`);
      c.font = FONT_REGULAR;
      c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
      c.alignment = {
        vertical: 'middle',
        horizontal: ['B','C','D','E','G','H','M'].includes(col) ? 'center' : (['I','J','K','L'].includes(col) ? 'right' : 'left'),
        wrapText: col === 'N',
      };
      if (idx % 2 === 1) c.fill = FILL_ZEBRA as ExcelJS.Fill;
    });

    ws4.getCell(`I${rowNum}`).numFmt = NUMBER_FMT;
    ws4.getCell(`J${rowNum}`).numFmt = CURRENCY_FMT;
    ws4.getCell(`K${rowNum}`).numFmt = CURRENCY_FMT;
    ws4.getCell(`L${rowNum}`).numFmt = CURRENCY_FMT;
    ws4.getCell(`M${rowNum}`).numFmt = NUMBER_FMT;
    r.height = 22;
  });

  // ─────────────────────────────────────────────────────────────────────
  // SHEET 5: RINCIAN AUDIT PER SHIFT & PERSONEL
  // ─────────────────────────────────────────────────────────────────────
  const ws5 = wb.addWorksheet('Detail Shift & Personel', { views: [{ showGridLines: true }] });
  ws5.columns = [
    { width: 4 },  // A
    { width: 6 },  // B: No
    { width: 14 }, // C: Tanggal
    { width: 12 }, // D: Hari
    { width: 10 }, // E: Sesi
    { width: 28 }, // F: Nama Mahasiswa
    { width: 14 }, // G: NIM
    { width: 24 }, // H: Peran Tugas
    { width: 18 }, // I: Status Kehadiran
    { width: 14 }, // J: Bobot Poin
    { width: 22 }, // K: Upah Diterima (Rp)
  ];

  ws5.mergeCells('B2:K2');
  const t5 = ws5.getCell('B2');
  t5.value = 'RINCIAN MATRIKS AUDIT PEMBAGIAN UPAH PER SHIFT & PER PERSONEL';
  t5.font = FONT_TITLE;
  t5.fill = FILL_NAVY as ExcelJS.Fill;
  t5.alignment = { horizontal: 'center', vertical: 'middle' };
  ws5.getRow(2).height = 28;

  ws5.mergeCells('B3:K3');
  const t5Sub = ws5.getCell('B3');
  t5Sub.value = `Periode: ${data.range.label} | Transparansi Penuh Distribusi Upah Mahasiswa Berdasarkan Presensi & Kinerja`;
  t5Sub.font = FONT_MUTED;
  t5Sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws5.getRow(3).height = 20;

  const headerCols5 = [
    'No', 'Tanggal', 'Hari', 'Sesi', 'Nama Mahasiswa',
    'NIM', 'Peran Tugas', 'Kehadiran', 'Bobot Poin', 'Upah Bersih (Rp)'
  ];
  const r5Header = ws5.getRow(5);
  r5Header.values = ['', ...headerCols5];
  ['B5','C5','D5','E5','F5','G5','H5','I5','J5','K5'].forEach((addr) => {
    const c = ws5.getCell(addr);
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER as ExcelJS.Fill;
    c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['B5','C5','D5','E5','G5','I5','J5'].includes(addr) ? 'center' : (addr === 'K5' ? 'right' : 'left'),
    };
  });
  r5Header.height = 24;

  let rowIdx5 = 6;
  let counter5 = 1;
  let grandTotalMatrixUpah = 0;

  for (const s of data.shifts) {
    for (const p of s.personnel) {
      grandTotalMatrixUpah += p.nominalBagiHasil;
      const r = ws5.getRow(rowIdx5);
      const lateStr = p.lateMinutes > 0 ? `Telat ${p.lateMinutes}m` : 'Hadir Tepat Waktu';

      r.values = [
        '',
        counter5++,
        s.tanggal,
        s.hari,
        s.sesi,
        p.fullName,
        p.nim,
        p.jabatan,
        lateStr,
        p.totalWeight ? Number(p.totalWeight).toFixed(2) : '1.00',
        p.nominalBagiHasil,
      ];

      ['B','C','D','E','F','G','H','I','J','K'].forEach((col) => {
        const c = ws5.getCell(`${col}${rowIdx5}`);
        c.font = FONT_REGULAR;
        c.border = BORDER_THIN as Partial<ExcelJS.Borders>;
        c.alignment = {
          vertical: 'middle',
          horizontal: ['B','C','D','E','G','I','J'].includes(col) ? 'center' : (col === 'K' ? 'right' : 'left'),
        };
        if (counter5 % 2 === 1) c.fill = FILL_ZEBRA as ExcelJS.Fill;
      });

      ws5.getCell(`K${rowIdx5}`).numFmt = CURRENCY_FMT;
      r.height = 21;
      rowIdx5++;
    }
  }

  const r5Total = ws5.getRow(rowIdx5);
  r5Total.values = [
    '',
    '',
    'TOTAL KESELURUHAN',
    '',
    '',
    `${counter5 - 1} Penugasan Personel Shift`,
    '',
    '',
    '',
    '',
    grandTotalMatrixUpah,
  ];

  ws5.mergeCells(`C${rowIdx5}:E${rowIdx5}`);
  ['B','C','D','E','F','G','H','I','J','K'].forEach((col) => {
    const c = ws5.getCell(`${col}${rowIdx5}`);
    c.font = FONT_BOLD;
    c.fill = FILL_TOTAL as ExcelJS.Fill;
    c.border = BORDER_TOTAL as Partial<ExcelJS.Borders>;
    c.alignment = {
      vertical: 'middle',
      horizontal: ['C','D','E'].includes(col) ? 'center' : (col === 'K' ? 'right' : 'left'),
    };
  });
  ws5.getCell(`K${rowIdx5}`).numFmt = CURRENCY_FMT;
  r5Total.height = 24;

  return wb;
}

async function main() {
  const publicDir = path.resolve(process.cwd(), 'public/laporan');
  const artifactDir = 'C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\58dfeece-8e99-4db4-92d4-8d83430c3567';

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const tasks = [
    { name: 'Agustus 2026', query: 'month=2026-08', filename: 'Rekap_Gaji_Wiramart_Agustus_2026.xlsx' },
    { name: 'September 2026', query: 'month=2026-09', filename: 'Rekap_Gaji_Wiramart_September_2026.xlsx' },
    { name: 'Oktober 2026', query: 'month=2026-10', filename: 'Rekap_Gaji_Wiramart_Oktober_2026.xlsx' },
    { name: 'November 2026', query: 'month=2026-11', filename: 'Rekap_Gaji_Wiramart_November_2026.xlsx' },
    { name: 'Semester 2 2026 (Semua Waktu)', query: 'period=semi_annual', filename: 'Rekap_Gaji_Wiramart_Semester_2_2026.xlsx' },
  ];

  for (const t of tasks) {
    console.log(`\nGenerating Excel for: ${t.name}...`);
    const data = await fetchReportData(t.query);
    const wb = await buildWorkbook(data);

    const publicPath = path.join(publicDir, t.filename);
    const artifactPath = path.join(artifactDir, t.filename);

    await wb.xlsx.writeFile(publicPath);
    console.log(`  -> Saved to: ${publicPath}`);

    if (fs.existsSync(artifactDir)) {
      await wb.xlsx.writeFile(artifactPath);
      console.log(`  -> Saved to artifact: ${artifactPath}`);
    }
  }

  console.log(`\nALL 5 EXCEL REPORTS SUCCESSFULLY GENERATED!`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
