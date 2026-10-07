import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import {
  transactions,
  shifts,
  employees,
  shiftSwapRequests,
  shiftCashMovements,
  qrisReconciliations,
  productProposals,
  stockBatches,
} from '@/lib/db/schema';
import { eq, and, gte, lte, sql, count, isNull, desc } from 'drizzle-orm';
import { formatRupiah, formatDateTime } from '@/lib/utils/helpers';
import { resolveReportRange, getFinancialReport, wibToday } from '@/lib/finance/report';
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Layers,
  ArrowUpRight,
  Clock,
  Coins,
  Building2,
  Percent,
  Wallet,
  ShieldCheck,
  Download,
} from 'lucide-react';
import DashboardWidgets from './DashboardWidgets';
import ApprovalCenterWidget, { type AutoClosedShiftInfo } from './ApprovalCenterWidget';

export const metadata: Metadata = { title: 'Dashboard Manajer & Dosen Pembina' };

// Revalidate every 60 seconds
export const revalidate = 60;

async function getDashboardData() {
  const todayWibStr = wibToday();
  const range = resolveReportRange({ period: 'daily' });

  // 1. Single Source of Truth: Laporan Keuangan Harian Terpadu
  const financialReport = await getFinancialReport(range);
  const { summary } = financialReport;

  // 2. Active shifts & total employees
  const [activeShiftsResult] = await db
    .select({ count: count(shifts.id) })
    .from(shifts)
    .where(eq(shifts.status, 'ACTIVE'));

  const [totalEmployeesResult] = await db
    .select({ count: count(employees.id) })
    .from(employees)
    .where(and(eq(employees.isActive, true), isNull(employees.deletedAt)));

  // 3. Approval Center: Pending Swap Requests (Menunggu Persetujuan Dosen)
  const [pendingSwapsResult] = await db
    .select({ count: count(shiftSwapRequests.id) })
    .from(shiftSwapRequests)
    .where(eq(shiftSwapRequests.status, 'PENDING'));

  // 4. Shift yang ditutup paksa oleh Cron hari ini (perlu audit fisik laci)
  const autoClosedShiftsRaw = await db.query.shifts.findMany({
    where: and(
      eq(shifts.status, 'CLOSED'),
      gte(shifts.clockIn, range.start),
      sql`${shifts.notes} ILIKE '%AUTO_CLOSED%'`,
    ),
    with: {
      employee: {
        columns: { fullName: true },
      },
    },
    limit: 5,
  });

  const autoClosedShifts: AutoClosedShiftInfo[] = autoClosedShiftsRaw.map((s) => ({
    id: s.id,
    employeeName: s.employee.fullName,
    clockIn: s.clockIn.toISOString(),
    clockOut: s.clockOut ? s.clockOut.toISOString() : null,
    notes: s.notes,
  }));

  // 5. Audit Kas Gerak (Petty Cash: Kas Keluar vs Kas Masuk Hari Ini)
  const [pettyCashResult] = await db
    .select({
      cashOut: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_OUT'), 0)`,
      cashIn:  sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_IN'), 0)`,
    })
    .from(shiftCashMovements)
    .where(gte(shiftCashMovements.createdAt, range.start));

  // 6. Status Rekonsiliasi QRIS Bulan Berjalan
  const currentMonthStr = todayWibStr.slice(0, 7); // 'YYYY-MM'
  const [qrisReconResult] = await db
    .select({
      totalDays:     sql<number>`COUNT(*)`,
      selisihCount:  sql<number>`COUNT(*) FILTER (WHERE ${qrisReconciliations.status} = 'SELISIH')`,
      pendingCount:  sql<number>`COUNT(*) FILTER (WHERE ${qrisReconciliations.status} = 'PENDING')`,
    })
    .from(qrisReconciliations)
    .where(sql`${qrisReconciliations.reconDate} >= ${currentMonthStr + '-01'}`);

  const hasQrisIssue =
    (qrisReconResult?.selisihCount ?? 0) > 0 ||
    (qrisReconResult?.pendingCount ?? 0) > 0;

  let qrisStatusText = 'Sinkron';
  if ((qrisReconResult?.selisihCount ?? 0) > 0) {
    qrisStatusText = `${qrisReconResult.selisihCount} Hari Selisih`;
  } else if ((qrisReconResult?.pendingCount ?? 0) > 0) {
    qrisStatusText = `${qrisReconResult.pendingCount} Belum Rekonsiliasi`;
  }

  // 6b. Pending Usulan Produk dari Kasir (K8)
  const [pendingProposalsResult] = await db
    .select({ count: count(productProposals.id) })
    .from(productProposals)
    .where(eq(productProposals.status, 'PENDING'));

  // 6c. Batch Stok Mendekati Kedaluwarsa (<= 7 hari atau expired) FEFO (F3)
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [criticalBatchesResult] = await db
    .select({
      count: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} <= ${in7Days} AND ${stockBatches.currentQty} > 0), 0)::int`,
    })
    .from(stockBatches);

  // 7. Recent Transactions (last 10 today)
  const recentTransactions = await db.query.transactions.findMany({
    where: and(
      gte(transactions.createdAt, range.start),
      lte(transactions.createdAt, range.endExclusive),
    ),
    with: { employee: { columns: { fullName: true } } },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  return {
    todayLabel: range.label,
    summary,
    activeShifts: activeShiftsResult?.count ?? 0,
    totalEmployees: totalEmployeesResult?.count ?? 0,
    pendingSwapsCount: pendingSwapsResult?.count ?? 0,
    pendingProposalsCount: pendingProposalsResult?.count ?? 0,
    criticalBatchesCount: criticalBatchesResult?.count ?? 0,
    autoClosedShiftsCount: autoClosedShifts.length,
    autoClosedShifts,
    pettyCashOut: Number(pettyCashResult?.cashOut ?? 0),
    pettyCashIn:  Number(pettyCashResult?.cashIn ?? 0),
    qrisNeedsAttention: hasQrisIssue,
    qrisStatusText,
    recentTransactions,
  };
}

export default async function AdminDashboardPage() {
  const data = await getDashboardData();
  const { summary } = data;

  const statCards = [
    {
      id: 'stat-revenue',
      label: 'Omzet Hari Ini',
      value: formatRupiah(summary.omzet),
      subtext: `Tunai: ${formatRupiah(summary.omzetCash)} &bull; QRIS: ${formatRupiah(summary.omzetQris)}`,
      icon: <TrendingUp size={20} aria-hidden="true" />,
      iconBg: 'var(--color-primary-light)',
      iconColor: 'var(--color-primary)',
      topColor: 'var(--color-primary)',
    },
    {
      id: 'stat-gross-profit',
      label: 'Laba Kotor Hari Ini',
      value: formatRupiah(summary.labaKotor),
      subtext: `HPP Terjual: ${formatRupiah(summary.hppTerjual)}`,
      icon: <ArrowUpRight size={20} aria-hidden="true" />,
      iconBg: 'var(--color-success-light)',
      iconColor: 'var(--color-success)',
      topColor: 'var(--color-success)',
    },
    {
      id: 'stat-student-share',
      label: 'Hak Bagi Hasil Mahasiswa',
      value: formatRupiah(summary.alokasiGajiKaryawan),
      subtext: 'Paten 50% Laba Bersih Operasional',
      icon: <Percent size={20} aria-hidden="true" />,
      iconBg: 'hsl(38 92% 50% / 0.15)',
      iconColor: 'hsl(38 92% 40%)',
      topColor: 'hsl(38 92% 50%)',
    },
    {
      id: 'stat-store-net',
      label: 'Laba Bersih Wiramart',
      value: formatRupiah(summary.labaBersih),
      subtext: `Opex: ${formatRupiah(summary.biayaOperasional)}`,
      icon: <Building2 size={20} aria-hidden="true" />,
      iconBg: 'hsl(217 91% 60% / 0.15)',
      iconColor: 'hsl(217 91% 50%)',
      topColor: 'hsl(217 91% 60%)',
    },
    {
      id: 'stat-transactions',
      label: 'Total Transaksi Selesai',
      value: `${summary.txCount} Trx`,
      subtext: summary.voidCount > 0 ? `${summary.voidCount} transaksi di-void` : 'Zero void hari ini',
      icon: <ShoppingBag size={20} aria-hidden="true" />,
      iconBg: 'var(--color-info-light)',
      iconColor: 'var(--color-info)',
      topColor: 'var(--color-info)',
    },
    {
      id: 'stat-shifts',
      label: 'Kasir On-Duty Sekarang',
      value: `${data.activeShifts} / ${data.totalEmployees}`,
      subtext: 'Karyawan terdaftar aktif',
      icon: <Users size={20} aria-hidden="true" />,
      iconBg: 'var(--color-accent-light)',
      iconColor: 'var(--color-accent-text)',
      topColor: 'var(--color-accent)',
    },
  ];

  return (
    <div>
      {/* Header Halaman Eksekutif */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Dashboard Manajer &amp; Dosen Pembina
            </h1>
            <span
              className="badge badge-success"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}
            >
              <ShieldCheck size={12} />
              Wiramart UNPERBA
            </span>
          </div>
          <p className="page-subtitle" style={{ marginTop: 'var(--space-1)' }}>
            Laporan finansial terpadu, persetujuan shift, dan pengawasan operasional kasir &bull; {data.todayLabel}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link href="/admin/export" className="btn btn-secondary btn-sm">
            <Download size={14} aria-hidden="true" />
            Ekspor Excel 1-Sheet
          </Link>
          <Link href="/admin/laporan" className="btn btn-primary btn-sm">
            <Layers size={14} aria-hidden="true" />
            Laporan Lengkap
          </Link>
        </div>
      </div>

      {/* Grid KPI Finansial Eksekutif */}
      <div className="grid-stats" role="region" aria-label="Statistik keuangan hari ini">
        {statCards.map((card) => (
          <article
            key={card.id}
            id={card.id}
            className="stat-card"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: card.topColor,
                borderRadius: 'var(--radius-full) var(--radius-full) 0 0',
              }}
              aria-hidden="true"
            />
            <div>
              <div
                className="stat-card__icon"
                style={{ backgroundColor: card.iconBg, color: card.iconColor }}
              >
                {card.icon}
              </div>
              <div className="stat-card__label">{card.label}</div>
              <div className="stat-card__value" style={{ fontSize: '1.35rem' }}>
                {card.value}
              </div>
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                marginTop: 'var(--space-2)',
                borderTop: '1px dashed var(--color-border)',
                paddingTop: 'var(--space-1)',
              }}
              dangerouslySetInnerHTML={{ __html: card.subtext }}
            />
          </article>
        ))}
      </div>

      {/* PUSAT KENDALI & APPROVAL CENTER (Dosen Pembina & Manajer Toko) */}
      <ApprovalCenterWidget
        pendingSwapsCount={data.pendingSwapsCount}
        pendingProposalsCount={data.pendingProposalsCount}
        criticalBatchesCount={data.criticalBatchesCount}
        autoClosedShiftsCount={data.autoClosedShiftsCount}
        autoClosedShifts={data.autoClosedShifts}
        qrisNeedsAttention={data.qrisNeedsAttention}
        qrisStatusText={data.qrisStatusText}
        pettyCashOut={data.pettyCashOut}
        pettyCashIn={data.pettyCashIn}
      />

      {/* Transaksi Hari Ini */}
      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: 'var(--text-base)', margin: 0 }}>
              Transaksi Kasir Terkini Hari Ini
            </h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              10 transaksi terakhir yang tercatat di sistem
            </span>
          </div>
          <Link href="/admin/laporan" className="btn btn-ghost btn-sm">
            Lihat Semua
          </Link>
        </div>

        {data.recentTransactions.length === 0 ? (
          <div
            className="card-body"
            style={{
              textAlign: 'center',
              padding: 'var(--space-12)',
              color: 'var(--color-text-muted)',
            }}
          >
            <ShoppingBag
              size={40}
              aria-hidden="true"
              style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }}
            />
            <p className="text-sm">Belum ada transaksi hari ini.</p>
          </div>
        ) : (
          <div className="table-wrapper" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
            <table className="table" aria-label="Daftar transaksi hari ini">
              <thead>
                <tr>
                  <th scope="col">No. Invoice</th>
                  <th scope="col">Waktu</th>
                  <th scope="col">Kasir</th>
                  <th scope="col">Metode</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((trx) => (
                  <tr key={trx.id}>
                    <td>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-primary)',
                          fontWeight: 'var(--weight-semibold)',
                        }}
                      >
                        {trx.invoiceNumber}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        <Clock size={12} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
                        {formatDateTime(trx.createdAt)}
                      </span>
                    </td>
                    <td>{trx.employee.fullName}</td>
                    <td>
                      <span
                        className={`badge ${trx.paymentMethod === 'CASH' ? 'badge-success' : 'badge-info'}`}
                      >
                        {trx.paymentMethod}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${trx.status === 'COMPLETED' ? 'badge-success' : 'badge-error'}`}
                      >
                        {trx.status === 'COMPLETED' ? 'Selesai' : 'Void'}
                      </span>
                    </td>
                    <td className="text-right">
                      <strong style={{ color: 'var(--color-primary)' }}>
                        {formatRupiah(parseFloat(trx.grossAmount))}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Realtime: Jadwal Hari Ini + Live Cash vs QRIS 30s Counter */}
      <DashboardWidgets />
    </div>
  );
}
