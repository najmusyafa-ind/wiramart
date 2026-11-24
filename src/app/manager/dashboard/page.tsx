import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRupiah, formatDateTime } from '@/lib/utils/helpers';
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Layers,
  ArrowUpRight,
  Clock,
  Building2,
  Percent,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { requireManagerActor } from '@/features/portal/server-auth';
import { getManagerDashboardData } from '@/features/portal/dashboard/dashboard-data';
import DashboardWidgets from '@/features/portal/dashboard/DashboardWidgets';
import ApprovalCenterWidget from '@/features/portal/dashboard/ApprovalCenterWidget';

export const metadata: Metadata = { title: 'Dashboard Manajer' };
export const revalidate = 60;

export default async function ManagerDashboardPage() {
  await requireManagerActor();
  const data = await getManagerDashboardData();
  const { summary } = data;

  const statCards = [
    {
      id: 'stat-revenue',
      label: 'Omzet Hari Ini',
      value: formatRupiah(summary.omzet),
      subtext: `Tunai: ${formatRupiah(summary.omzetCash)} · QRIS: ${formatRupiah(summary.omzetQris)}`,
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
      subtext: summary.voidCount > 0 ? `${summary.voidCount} transaksi dibatalkan` : 'Tidak ada transaksi void',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Dashboard Manajer
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
            Ringkasan keuangan, persetujuan, dan aktivitas kasir · {data.todayLabel}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/manager/export" className="btn btn-secondary btn-sm">
            <Download size={14} aria-hidden="true" />
            Ekspor Excel
          </Link>
          <Link href="/manager/laporan" className="btn btn-primary btn-sm">
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
              <div className="stat-card__value" style={{ fontSize: '1.35rem', fontVariantNumeric: 'tabular-nums' }}>
                {card.value}
              </div>
            </div>
            <div
              style={{
                fontSize: '0.73rem',
                color: 'var(--color-text-muted)',
                marginTop: 'var(--space-2)',
                borderTop: '1px dashed var(--color-border)',
                paddingTop: 'var(--space-1)',
              }}
            >
              {card.subtext}
            </div>
          </article>
        ))}
      </div>

      {/* PUSAT KENDALI & APPROVAL CENTER */}
      <ApprovalCenterWidget
        pendingSwapsCount={data.pendingSwapsCount}
        pendingProposalsCount={data.pendingProposalsCount}
        criticalBatchesCount={data.criticalBatchesCount}
        pendingStockReceivesCount={data.pendingStockReceivesCount}
        pendingConditionReportsCount={data.pendingConditionReportsCount}
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
          <Link href="/manager/laporan" className="btn btn-ghost btn-sm">
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
          <>
            <div className="table-wrapper rep-desktop-only" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
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

            <div className="rep-mobile-only" style={{ padding: 'var(--space-3)' }}>
              {data.recentTransactions.map((trx) => (
                <div key={trx.id} className="rep-mcard">
                  <div className="rep-mcard__top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                        {trx.invoiceNumber}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {trx.employee.fullName} · {formatDateTime(trx.createdAt)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatRupiah(parseFloat(trx.grossAmount))}
                      </div>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 3 }}>
                        <span className={`badge ${trx.paymentMethod === 'CASH' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '0.68rem' }}>
                          {trx.paymentMethod}
                        </span>
                        <span className={`badge ${trx.status === 'COMPLETED' ? 'badge-success' : 'badge-error'}`} style={{ fontSize: '0.68rem' }}>
                          {trx.status === 'COMPLETED' ? 'Selesai' : 'Void'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Realtime: Jadwal Hari Ini + Live Cash vs QRIS 30s Counter */}
      <DashboardWidgets />
    </div>
  );
}

