'use client';

import { Fragment, useState, useMemo } from 'react';
import {
  QrCode,
  Banknote,
  ArrowLeftRight,
  FileText,
  Search,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Receipt,
} from 'lucide-react';
import { useTableSelection } from '@/hooks/useTableSelection';
import { SelectAllCheckbox, SelectedRowsBar } from '@/components/admin/SelectedRowsBar';
import { exportSelectedRowsToExcel, todayWibSlug } from '@/lib/utils/exportSelectedExcel';
import { formatRupiah, formatTanggalWib, type DailyRowUi } from './shared';

export type TransaksiQrisRow = {
  id: string;
  invoiceNumber: string;
  paymentMethod: 'CASH' | 'QRIS' | 'SPLIT';
  payments?: { paymentMethod: 'CASH' | 'QRIS'; amount: string }[];
  status: 'COMPLETED' | 'VOID';
  grossAmount: string;
  cashReceived: string | null;
  changeAmount: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  employeeName: string;
  employeeId: string;
};

type HourlyQrisRow = {
  jam: string;
  jumlahTx: number;
  totalQris: number;
};

type TransaksiQrisPanelProps = {
  dailyRows: DailyRowUi[];
  transactions: TransaksiQrisRow[];
  summary: {
    amountCash: number;
    amountQris: number;
    countCash: number;
    countQris: number;
    totalCount: number;
    countVoid: number;
    voidAmount: number;
  };
  periodLabel: string;
  onVoidRequest: (tx: TransaksiQrisRow) => void;
};

function formatRp(val: string | number): string {
  return formatRupiah(Number(val) || 0);
}

function formatDateTimeWib(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export default function TransaksiQrisPanel({
  dailyRows,
  transactions,
  summary,
  periodLabel,
  onVoidRequest,
}: TransaksiQrisPanelProps) {
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'CASH' | 'QRIS' | 'SPLIT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'VOID'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // State ekspansi cek QRIS per jam untuk dicocokkan dengan HP / grup WA Bu Dyah
  const [expandedQrisDate, setExpandedQrisDate] = useState<string | null>(null);
  const [hourlyCache, setHourlyCache] = useState<Record<string, HourlyQrisRow[]>>({});
  const [hourlyLoadingDate, setHourlyLoadingDate] = useState<string | null>(null);

  const txSelection = useTableSelection();

  const qrisDailyRows = useMemo(() => {
    return [...dailyRows]
      .filter((d) => (d.omzetQris ?? 0) > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [dailyRows]);

  async function handleToggleQrisDate(dateStr: string) {
    if (expandedQrisDate === dateStr) {
      setExpandedQrisDate(null);
      return;
    }
    setExpandedQrisDate(dateStr);
    if (hourlyCache[dateStr]) return;

    setHourlyLoadingDate(dateStr);
    try {
      const res = await fetch(`/api/admin/qris-rekonsiliasi/${dateStr}`);
      const json = await res.json();
      if (res.ok && json?.success && Array.isArray(json.data?.breakdownPerJam)) {
        setHourlyCache((prev) => ({ ...prev, [dateStr]: json.data.breakdownPerJam as HourlyQrisRow[] }));
      } else {
        setHourlyCache((prev) => ({ ...prev, [dateStr]: [] }));
      }
    } catch {
      setHourlyCache((prev) => ({ ...prev, [dateStr]: [] }));
    } finally {
      setHourlyLoadingDate(null);
    }
  }

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((t) => {
      if (methodFilter !== 'ALL' && t.paymentMethod !== methodFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.invoiceNumber.toLowerCase().includes(q) ||
        t.employeeName.toLowerCase().includes(q) ||
        t.paymentMethod.toLowerCase().includes(q)
      );
    });
  }, [transactions, methodFilter, statusFilter, searchQuery]);

  const visibleTxIds = useMemo(
    () => filteredTransactions.map((t) => t.id),
    [filteredTransactions],
  );

  const selectedTxs = useMemo(
    () => filteredTransactions.filter((t) => txSelection.isSelected(t.id)),
    [filteredTransactions, txSelection],
  );

  const selectedTxStats = useMemo(
    () =>
      selectedTxs.reduce(
        (acc, t) => {
          const amt = Number(t.grossAmount) || 0;
          if (t.status === 'VOID') {
            acc.voidCount += 1;
            acc.voidAmount += amt;
          } else {
            acc.validCount += 1;
            acc.validAmount += amt;
          }
          if (t.paymentMethod === 'CASH') acc.cashCount += 1;
          else if (t.paymentMethod === 'QRIS') acc.qrisCount += 1;
          else acc.splitCount += 1;
          return acc;
        },
        { validCount: 0, validAmount: 0, voidCount: 0, voidAmount: 0, cashCount: 0, qrisCount: 0, splitCount: 0 },
      ),
    [selectedTxs],
  );

  async function handleExportSelectedTx() {
    if (selectedTxs.length === 0) return;
    await exportSelectedRowsToExcel({
      filename: `transaksi-terpilih-${todayWibSlug()}.xlsx`,
      sheetName: 'Transaksi Terpilih',
      title: `TRANSAKSI TERPILIH (${selectedTxs.length} Struk)`,
      subtitle: `Periode: ${periodLabel} | Dicetak ${todayWibSlug()} WIB`,
      rows: selectedTxs,
      columns: [
        { header: 'Invoice', key: 'invoiceNumber', width: 22, format: 'text', aggregate: 'count', value: (t) => t.invoiceNumber },
        { header: 'Waktu (WIB)', key: 'createdAt', width: 20, format: 'text', aggregate: 'none', value: (t) => formatDateTimeWib(t.createdAt) },
        { header: 'Kasir', key: 'employeeName', width: 24, format: 'text', aggregate: 'none', value: (t) => t.employeeName },
        { header: 'Metode', key: 'paymentMethod', width: 12, format: 'text', aggregate: 'none', value: (t) => t.paymentMethod },
        { header: 'Status', key: 'status', width: 12, format: 'text', aggregate: 'none', value: (t) => (t.status === 'VOID' ? 'VOID' : 'OK') },
        { header: 'Nominal Bruto (Rp)', key: 'grossAmount', width: 18, format: 'currency', aggregate: 'sum', value: (t) => parseFloat(t.grossAmount) || 0 },
        { header: 'Nominal Valid (Rp)', key: 'validAmount', width: 18, format: 'currency', aggregate: 'sum', value: (t) => (t.status === 'COMPLETED' ? parseFloat(t.grossAmount) || 0 : 0) },
        { header: 'Alasan Void', key: 'voidReason', width: 28, format: 'text', aggregate: 'none', value: (t) => t.voidReason ?? '' },
      ],
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* 1. Ringkasan Singkat Pembayaran */}
      <div className="rep-kpi-grid rep-kpi-grid--3" style={{ marginBottom: 0 }}>
        {[
          {
            label: 'QRIS (Bu Dyah)',
            value: formatRp(summary.amountQris),
            sub: `${summary.countQris} tx`,
            color: '#0369a1',
            icon: <QrCode size={15} />,
          },
          {
            label: 'Tunai',
            value: formatRp(summary.amountCash),
            sub: `${summary.countCash} tx`,
            color: '#15803d',
            icon: <Banknote size={15} />,
          },
          {
            label: 'Total Struk',
            value: `${summary.totalCount.toLocaleString('id-ID')} valid`,
            sub: summary.countVoid > 0 ? `${summary.countVoid} void (${formatRp(summary.voidAmount)})` : '0 void',
            color: summary.countVoid > 0 ? '#dc2626' : '#0f172a',
            icon: <Receipt size={15} />,
          },
        ].map((card) => (
          <div key={card.label} className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">{card.label}</span>
              <span style={{ color: card.color }}>{card.icon}</span>
            </div>
            <div className="rep-kpi__val" style={{ color: card.color }}>{card.value}</div>
            <div className="rep-kpi__sub">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* 2. Rekap QRIS Harian (Cek Cepat HP Bu Dyah) */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          className="card-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            <QrCode size={16} style={{ color: '#0369a1' }} aria-hidden="true" />
            <span>QRIS Harian (Bu Dyah)</span>
          </h2>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#0369a1' }}>
            {qrisDailyRows.length} hari · klik baris untuk jam
          </span>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {qrisDailyRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              Belum ada transaksi QRIS pada periode ini.
            </div>
          ) : (
            <>
              {/* Desktop QRIS Table */}
              <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.75rem', color: '#475569' }}>Tanggal</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: '0.75rem', color: '#475569' }}>Total Trx</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '0.75rem', color: '#0369a1' }}>Total QRIS</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '0.75rem', color: '#15803d' }}>Total Tunai</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '0.75rem', color: '#0f172a' }}>Total Omzet Hari</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: '0.75rem', color: '#475569', width: 110 }}>Rincian Jam</th>
                </tr>
              </thead>
              <tbody>
                {qrisDailyRows.map((d) => {
                  const isOpen = expandedQrisDate === d.date;
                  const hourly = hourlyCache[d.date];
                  const isLoadingHourly = hourlyLoadingDate === d.date;
                  return (
                    <Fragment key={d.date}>
                      <tr
                        onClick={() => handleToggleQrisDate(d.date)}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          cursor: 'pointer',
                          backgroundColor: isOpen ? '#f0f9ff' : undefined,
                        }}
                      >
                        <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatTanggalWib(d.date)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#475569' }}>
                          {d.txCount} tx
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#0369a1', whiteSpace: 'nowrap' }}>
                          {formatRp(d.omzetQris)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#15803d', whiteSpace: 'nowrap' }}>
                          {formatRp(d.omzetCash)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatRp(d.omzet)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              borderRadius: 6,
                              border: '1px solid #bae6fd',
                              background: '#ffffff',
                              color: '#0369a1',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {isOpen ? 'Tutup' : 'Per Jam'}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${d.date}-detail`} style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                          <td colSpan={6} style={{ padding: '10px 16px' }}>
                            {isLoadingHourly ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#64748b' }}>
                                <Loader2 size={14} className="spin-icon" /> Memuat rincian QRIS per jam...
                              </div>
                            ) : !hourly || hourly.length === 0 ? (
                              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                Tidak ada rincian per jam untuk tanggal ini.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {hourly.map((h) => (
                                  <div
                                    key={h.jam}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      padding: '6px 10px',
                                      borderRadius: 8,
                                      background: '#ffffff',
                                      border: '1px solid #bae6fd',
                                      fontSize: '0.76rem',
                                    }}
                                  >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569', fontWeight: 600 }}>
                                      <Clock size={12} /> {h.jam}
                                    </span>
                                    <span style={{ color: '#64748b' }}>({h.jumlahTx} tx)</span>
                                    <strong style={{ color: '#0369a1' }}>{formatRp(h.totalQris)}</strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                  })}
                </tbody>
              </table>
              </div>

              {/* Mobile QRIS Cards */}
              <div className="rep-mobile-only" style={{ padding: '10px 12px' }}>
                {qrisDailyRows.map((d) => {
                  const isOpen = expandedQrisDate === d.date;
                  const hourly = hourlyCache[d.date];
                  const isLoadingHourly = hourlyLoadingDate === d.date;
                  return (
                    <div
                      key={d.date}
                      className="rep-mcard"
                      onClick={() => handleToggleQrisDate(d.date)}
                      style={{ cursor: 'pointer', borderColor: isOpen ? '#0284c7' : '#e2e8f0' }}
                    >
                      <div className="rep-mcard__top">
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#0f172a' }}>{formatTanggalWib(d.date)}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {d.txCount} tx · Tunai {formatRp(d.omzetCash)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0369a1' }}>{formatRp(d.omzetQris)}</div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', fontWeight: 700, color: '#0369a1' }}>
                            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {isOpen ? 'Tutup' : 'Per Jam'}
                          </span>
                        </div>
                      </div>
                      {isOpen && (
                        <div style={{ paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                          {isLoadingHourly ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#64748b' }}>
                              <Loader2 size={13} className="spin-icon" /> Memuat per jam...
                            </div>
                          ) : !hourly || hourly.length === 0 ? (
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Tidak ada rincian jam.</div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {hourly.map((h) => (
                                <span
                                  key={h.jam}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '4px 8px',
                                    borderRadius: 8,
                                    background: '#f0f9ff',
                                    border: '1px solid #bae6fd',
                                    fontSize: '0.72rem',
                                  }}
                                >
                                  <span style={{ color: '#475569', fontWeight: 600 }}>{h.jam}</span>
                                  <strong style={{ color: '#0369a1' }}>{formatRp(h.totalQris)}</strong>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Daftar Struk Transaksi (Filter Cash / QRIS / Split + Void) */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          className="card-header"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <FileText size={16} aria-hidden="true" />
              <span>Daftar Struk Transaksi</span>
            </h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Menampilkan {filteredTransactions.length} dari {transactions.length} transaksi
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="rep-chip-bar" style={{ flex: '1 1 auto' }}>
              {(
                [
                  { id: 'ALL', label: 'Semua' },
                  { id: 'CASH', label: 'Cash' },
                  { id: 'QRIS', label: 'QRIS' },
                  { id: 'SPLIT', label: 'Split' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethodFilter(m.id)}
                  className={`rep-chip${methodFilter === m.id ? ' active' : ''}`}
                >
                  {m.label}
                </button>
              ))}
              <select
                aria-label="Filter status transaksi"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'COMPLETED' | 'VOID')}
                className="form-input"
                style={{ width: 'auto', minHeight: 36, padding: '4px 10px', fontSize: '0.76rem', flexShrink: 0 }}
              >
                <option value="ALL">Semua Status</option>
                <option value="COMPLETED">Valid</option>
                <option value="VOID">Void</option>
              </select>
            </div>

            <div className="form-input-icon" style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}>
              <Search size={14} className="form-input-icon__icon" aria-hidden="true" />
              <input
                type="search"
                className="form-input form-input-icon__input"
                placeholder="Cari struk / kasir..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ minHeight: 38, fontSize: '0.84rem' }}
              />
            </div>
          </div>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {filteredTransactions.length === 0 ? (
            <p style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              Tidak ada transaksi pada filter ini.
            </p>
          ) : (
            <>
              <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
                    <th scope="col" style={{ padding: 'var(--space-3)', width: 38, textAlign: 'center' }}>
                      <SelectAllCheckbox
                        checked={txSelection.allVisibleSelected(visibleTxIds)}
                        indeterminate={txSelection.someVisibleSelected(visibleTxIds)}
                        onChange={() => txSelection.toggleAll(visibleTxIds)}
                        ariaLabel="Pilih semua transaksi terlihat"
                      />
                    </th>
                    {['Invoice', 'Waktu (WIB)', 'Kasir', 'Metode', 'Total', 'Status', 'Aksi'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        style={{
                          padding: 'var(--space-3) var(--space-4)',
                          textAlign: 'left',
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--color-text-muted)',
                          fontSize: 'var(--text-xs)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => {
                    const isSelected = txSelection.isSelected(t.id);
                    return (
                      <tr
                        key={t.id}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          opacity: t.status === 'VOID' ? 0.55 : 1,
                          backgroundColor: isSelected ? 'hsl(152 60% 96% / 0.7)' : undefined,
                        }}
                      >
                        <td style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => txSelection.toggleRow(t.id)}
                            aria-label={`Pilih transaksi ${t.invoiceNumber}`}
                            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-primary)', verticalAlign: 'middle' }}
                          />
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'monospace', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                          {t.invoiceNumber}
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                          {formatDateTimeWib(t.createdAt)}
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap' }}>
                          {t.employeeName}
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                          <span
                            title={
                              t.paymentMethod === 'SPLIT' && t.payments && t.payments.length > 0
                                ? t.payments.map((p) => `${p.paymentMethod}: ${formatRp(p.amount)}`).join(' + ')
                                : undefined
                            }
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: 'var(--text-xs)',
                              fontWeight: 'var(--weight-semibold)',
                              backgroundColor:
                                t.paymentMethod === 'CASH'
                                  ? 'var(--color-success-light)'
                                  : t.paymentMethod === 'QRIS'
                                  ? 'var(--color-info-light)'
                                  : 'hsl(var(--color-primary-h, 220), 80%, 93%)',
                              color:
                                t.paymentMethod === 'CASH'
                                  ? 'var(--color-success)'
                                  : t.paymentMethod === 'QRIS'
                                  ? 'var(--color-info)'
                                  : 'var(--color-primary)',
                            }}
                          >
                            {t.paymentMethod === 'CASH' ? (
                              <Banknote size={11} aria-hidden="true" />
                            ) : t.paymentMethod === 'QRIS' ? (
                              <QrCode size={11} aria-hidden="true" />
                            ) : (
                              <ArrowLeftRight size={11} aria-hidden="true" />
                            )}
                            {t.paymentMethod}
                          </span>
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)', whiteSpace: 'nowrap' }}>
                          {formatRp(t.grossAmount)}
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                          {t.status === 'VOID' ? (
                            <span
                              title={t.voidReason ?? ''}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 'var(--weight-semibold)',
                                backgroundColor: 'var(--color-error-light)',
                                color: 'var(--color-error)',
                              }}
                            >
                              <AlertTriangle size={11} aria-hidden="true" /> VOID
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 'var(--weight-semibold)',
                                backgroundColor: 'var(--color-success-light)',
                                color: 'var(--color-success)',
                              }}
                            >
                              <CheckCircle size={11} aria-hidden="true" /> OK
                            </span>
                          )}
                        </td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                          {t.status === 'COMPLETED' && (
                            <button
                              type="button"
                              onClick={() => onVoidRequest(t)}
                              aria-label={`Void transaksi ${t.invoiceNumber}`}
                              style={{
                                background: 'none',
                                border: '1px solid var(--color-error)',
                                color: 'var(--color-error)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '3px 10px',
                                fontSize: 'var(--text-xs)',
                                cursor: 'pointer',
                                fontWeight: 'var(--weight-semibold)',
                              }}
                            >
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* Mobile Receipt List */}
              <div className="rep-mobile-only" style={{ padding: '10px 12px' }}>
                {filteredTransactions.map((t) => (
                  <div
                    key={t.id}
                    className="rep-mcard"
                    style={{ opacity: t.status === 'VOID' ? 0.6 : 1 }}
                  >
                    <div className="rep-mcard__top">
                      <div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: '#0f172a' }}>
                          {t.invoiceNumber}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {formatDateTimeWib(t.createdAt)} · {t.employeeName}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                          {formatRp(t.grossAmount)}
                        </div>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '1px 7px',
                            borderRadius: 99,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: t.paymentMethod === 'CASH' ? '#dcfce7' : t.paymentMethod === 'QRIS' ? '#e0f2fe' : '#eef2ff',
                            color: t.paymentMethod === 'CASH' ? '#15803d' : t.paymentMethod === 'QRIS' ? '#0369a1' : '#4338ca',
                          }}
                        >
                          {t.paymentMethod}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
                      {t.status === 'VOID' ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626' }}>
                          VOID{t.voidReason ? ` · ${t.voidReason}` : ''}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#15803d' }}>Valid</span>
                      )}
                      {t.status === 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => onVoidRequest(t)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#dc2626',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Void
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <SelectedRowsBar
                selectedCount={selectedTxs.length}
                itemLabel="transaksi"
                metrics={[
                  { label: 'Valid (OK)', value: `${selectedTxStats.validCount} trx · ${formatRp(selectedTxStats.validAmount)}`, tone: 'success' },
                  { label: 'Void', value: `${selectedTxStats.voidCount} trx · ${formatRp(selectedTxStats.voidAmount)}`, tone: selectedTxStats.voidCount > 0 ? 'danger' : 'default' },
                  { label: 'Metode', value: `Cash ${selectedTxStats.cashCount} · QRIS ${selectedTxStats.qrisCount} · Split ${selectedTxStats.splitCount}`, tone: 'info' },
                ]}
                onExportExcel={handleExportSelectedTx}
                onClear={txSelection.clearSelection}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
