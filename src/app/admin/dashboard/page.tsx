import type { Metadata } from 'next';
import { db } from '@/lib/db/client';
import { transactions, shifts, employees } from '@/lib/db/schema';
import { eq, and, gte, lte, sql, count, isNull } from 'drizzle-orm';
import { formatRupiah, formatDateTime, getPeriodRange } from '@/lib/utils/helpers';
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Layers,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import DashboardWidgets from './DashboardWidgets';

export const metadata: Metadata = { title: 'Dashboard' };

// Revalidate every 60 seconds
export const revalidate = 60;

async function getDashboardData() {
  const today = getPeriodRange('daily');

  // Today's transactions (COMPLETED only)
  const [todayStats] = await db
    .select({
      totalRevenue: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
      totalProfit: sql<string>`COALESCE(SUM(${transactions.grossProfit}), 0)`,
      totalTransactions: count(transactions.id),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.status, 'COMPLETED'),
        gte(transactions.createdAt, today.start),
        lte(transactions.createdAt, today.end),
      ),
    );

  // Active shifts count
  const [activeShiftsResult] = await db
    .select({ count: count(shifts.id) })
    .from(shifts)
    .where(eq(shifts.status, 'ACTIVE'));

  // Total active employees
  const [totalEmployeesResult] = await db
    .select({ count: count(employees.id) })
    .from(employees)
    .where(and(eq(employees.isActive, true), isNull(employees.deletedAt)));

  // Recent transactions (last 10 today)
  const recentTransactions = await db.query.transactions.findMany({
    where: and(
      gte(transactions.createdAt, today.start),
      lte(transactions.createdAt, today.end),
    ),
    with: { employee: { columns: { fullName: true } } },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  return {
    todayRevenue: parseFloat(todayStats?.totalRevenue ?? '0'),
    todayProfit: parseFloat(todayStats?.totalProfit ?? '0'),
    todayTransactions: todayStats?.totalTransactions ?? 0,
    activeShifts: activeShiftsResult?.count ?? 0,
    totalEmployees: totalEmployeesResult?.count ?? 0,
    recentTransactions,
    todayLabel: today.label,
  };
}

export default async function AdminDashboardPage() {
  const data = await getDashboardData();

  const statCards = [
    {
      id: 'stat-revenue',
      label: 'Omzet Hari Ini',
      value: formatRupiah(data.todayRevenue),
      icon: <TrendingUp size={22} aria-hidden="true" />,
      iconBg: 'var(--color-primary-light)',
      iconColor: 'var(--color-primary)',
      topColor: 'var(--color-primary)',
    },
    {
      id: 'stat-profit',
      label: 'Laba Kotor Hari Ini',
      value: formatRupiah(data.todayProfit),
      icon: <ArrowUpRight size={22} aria-hidden="true" />,
      iconBg: 'var(--color-success-light)',
      iconColor: 'var(--color-success)',
      topColor: 'var(--color-success)',
    },
    {
      id: 'stat-transactions',
      label: 'Total Transaksi',
      value: data.todayTransactions.toString(),
      icon: <ShoppingBag size={22} aria-hidden="true" />,
      iconBg: 'var(--color-info-light)',
      iconColor: 'var(--color-info)',
      topColor: 'var(--color-info)',
    },
    {
      id: 'stat-shifts',
      label: 'Kasir Aktif Sekarang',
      value: `${data.activeShifts} / ${data.totalEmployees}`,
      icon: <Users size={22} aria-hidden="true" />,
      iconBg: 'var(--color-accent-light)',
      iconColor: 'var(--color-accent-text)',
      topColor: 'var(--color-accent)',
    },
  ];

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Rekap hari ini — {data.todayLabel}</p>
        </div>
        <a href="/admin/laporan" className="btn btn-secondary btn-sm">
          <Layers size={14} aria-hidden="true" />
          Lihat Laporan Lengkap
        </a>
      </div>

      {/* Stat Cards */}
      <div className="grid-stats" role="region" aria-label="Statistik hari ini">
        {statCards.map((card) => (
          <article key={card.id} id={card.id} className="stat-card">
            <div
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 3,
                background: card.topColor,
                borderRadius: 'var(--radius-full) var(--radius-full) 0 0',
              }}
              aria-hidden="true"
            />
            <div
              className="stat-card__icon"
              style={{ backgroundColor: card.iconBg, color: card.iconColor }}
            >
              {card.icon}
            </div>
            <div className="stat-card__label">{card.label}</div>
            <div className="stat-card__value">{card.value}</div>
          </article>
        ))}
      </div>

      {/* Recent Transactions */}
      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <div className="card-header">
          <h2 className="card-title" style={{ fontSize: 'var(--text-base)' }}>
            Transaksi Hari Ini
          </h2>
          <a href="/admin/laporan" className="btn btn-ghost btn-sm">
            Lihat Semua
          </a>
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

      {/* ── Realtime: Jadwal Hari Ini + Cash vs QRIS ── */}
      <DashboardWidgets />
    </div>
  );
}
