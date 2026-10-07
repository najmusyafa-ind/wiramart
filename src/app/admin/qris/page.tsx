'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  QrCode,
  Building2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Search,
  ArrowRight,
  HelpCircle,
  FileText,
  DollarSign,
  TrendingUp,
  X,
  Loader2,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';

type ReconRow = {
  id: string;
  reconDate: string;
  bankCreditAmount: number;
  systemQrisAmount: number;
  selisih: number;
  status: 'PENDING' | 'MATCH' | 'SELISIH';
  notes: string | null;
  updatedAt: string;
};

type HourlyBreakdown = {
  jam: string;
  jumlahTx: number;
  totalQris: number;
};

type DetailData = {
  tanggal: string;
  systemQrisAmount: number;
  bankCreditAmount: number;
  selisih: number;
  statusExisting: string;
  notes: string | null;
  lastUpdated: string | null;
  breakdownPerJam: HourlyBreakdown[];
};

export default function QrisRekonsiliasiPage() {
  const [bulan, setBulan] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [summary, setSummary] = useState({
    totalBank: 0,
    totalSystem: 0,
    totalSelisih: 0,
  });

  // Modal State
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [bankInput, setBankInput] = useState<string>('');
  const [notesInput, setNotesInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const bankInputId = useId();
  const notesInputId = useId();

  const fetchRekonsiliasi = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/qris-rekonsiliasi?bulan=${bulan}`);
      const json = await res.json();
      if (json.success && json.data) {
        setRows(json.data.rows ?? []);
        setSummary(json.data.ringkasan ?? { totalBank: 0, totalSystem: 0, totalSelisih: 0 });
      }
    } catch (err) {
      console.error('Gagal mengambil data rekonsiliasi:', err);
    } finally {
      setLoading(false);
    }
  }, [bulan]);

  useEffect(() => {
    fetchRekonsiliasi();
  }, [fetchRekonsiliasi]);

  const openDetailModal = async (date: string) => {
    setSelectedDate(date);
    setDetailLoading(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const res = await fetch(`/api/admin/qris-rekonsiliasi/${date}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d: DetailData = json.data;
        setDetail(d);
        setBankInput(d.bankCreditAmount > 0 ? String(d.bankCreditAmount) : '');
        setNotesInput(d.notes ?? '');
      }
    } catch {
      setSubmitError('Gagal memuat detail transaksi QRIS.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSimpanRekonsiliasi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    const nominalNum = Number(bankInput.replace(/\D/g, '')) || 0;

    try {
      const res = await fetch('/api/admin/qris-rekonsiliasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reconDate: selectedDate,
          bankCreditAmount: nominalNum,
          notes: notesInput.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || json.error || 'Gagal menyimpan rekonsiliasi');
      }

      setSubmitSuccess(true);
      fetchRekonsiliasi();
      setTimeout(() => {
        setSelectedDate(null);
      }, 1200);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Terjadi kesalahan sistem.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ padding: 'var(--space-6) 0', maxWidth: 1200 }}>
      {/* Header Halaman */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
              }}
            >
              <QrCode size={22} />
            </span>
            <h1 className="page-title" style={{ margin: 0 }}>
              Rekonsiliasi Harian Bank QRIS
            </h1>
          </div>
          <p className="page-subtitle" style={{ marginTop: 'var(--space-1)' }}>
            Verifikasi mutasi kredit rekening bank Mandiri / Livin&apos; dengan rekap omzet kasir untuk mencegah nota palsu.
          </p>
        </div>

        {/* Filter Bulan & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Calendar size={18} style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="month"
              value={bulan}
              onChange={(e) => setBulan(e.target.value)}
              className="form-control"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            />
          </div>

          <button
            onClick={fetchRekonsiliasi}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Muat Ulang
          </button>
        </div>
      </div>

      {/* KPI Cards / Ringkasan Finansial QRIS */}
      <div className="grid-stats" style={{ marginBottom: 'var(--space-6)' }}>
        <article className="stat-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
          <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
            <QrCode size={20} />
          </div>
          <div className="stat-card__label">Total Kasir (Sistem)</div>
          <div className="stat-card__value" style={{ color: 'var(--color-primary)' }}>
            {formatRupiah(summary.totalSystem)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Akumulasi transaksi QRIS di aplikasi
          </span>
        </article>

        <article className="stat-card" style={{ borderLeft: '4px solid var(--color-success)' }}>
          <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-success-light)', color: 'var(--color-success)' }}>
            <Building2 size={20} />
          </div>
          <div className="stat-card__label">Total Masuk Bank (Livin&apos;)</div>
          <div className="stat-card__value" style={{ color: 'var(--color-success)' }}>
            {formatRupiah(summary.totalBank)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Mutasi kredit riil rekening bank
          </span>
        </article>

        <article
          className="stat-card"
          style={{
            borderLeft: `4px solid ${
              Math.abs(summary.totalSelisih) <= 500
                ? 'var(--color-success)'
                : summary.totalSelisih < 0
                ? 'var(--color-error)'
                : 'var(--color-warning)'
            }`,
          }}
        >
          <div
            className="stat-card__icon"
            style={{
              backgroundColor:
                Math.abs(summary.totalSelisih) <= 500
                  ? 'var(--color-success-light)'
                  : summary.totalSelisih < 0
                  ? 'var(--color-error-light)'
                  : 'var(--color-warning-light)',
              color:
                Math.abs(summary.totalSelisih) <= 500
                  ? 'var(--color-success)'
                  : summary.totalSelisih < 0
                  ? 'var(--color-error)'
                  : 'var(--color-warning)',
            }}
          >
            {Math.abs(summary.totalSelisih) <= 500 ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </div>
          <div className="stat-card__label">Total Selisih Akumulasi</div>
          <div
            className="stat-card__value"
            style={{
              color:
                Math.abs(summary.totalSelisih) <= 500
                  ? 'var(--color-success)'
                  : summary.totalSelisih < 0
                  ? 'var(--color-error)'
                  : 'var(--color-warning)',
            }}
          >
            {summary.totalSelisih >= 0 ? '+' : ''}
            {formatRupiah(summary.totalSelisih)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {Math.abs(summary.totalSelisih) <= 500
              ? 'Sinkron & Cocok'
              : summary.totalSelisih < 0
              ? 'Waspada: Uang bank kurang dari kasir'
              : 'Surplus mutasi bank'}
          </span>
        </article>
      </div>

      {/* Tabel Rekonsiliasi Harian */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: '1rem', margin: 0 }}>
              Riwayat Rekonsiliasi Tanggal ({bulan})
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
              Klik tombol aksi pada tanggal yang ingin Anda periksa atau masukkan bukti rekening koran.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
              }}
            >
              <HelpCircle size={14} /> Toleransi selisih otomatis: Rp 500
            </span>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto var(--space-3)' }} />
            <p>Memuat rekap rekonsiliasi QRIS...</p>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <QrCode size={40} style={{ margin: '0 auto var(--space-3)', opacity: 0.3 }} />
            <p style={{ fontWeight: 600 }}>Belum ada data rekonsiliasi tercatat untuk bulan {bulan}.</p>
            <p style={{ fontSize: '0.85rem' }}>
              Masukkan tanggal hari ini untuk mulai mencocokkan mutasi rekening.
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table" aria-label="Tabel Rekonsiliasi QRIS">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 140 }}>Tanggal</th>
                  <th scope="col" className="text-right">Kasir (Sistem)</th>
                  <th scope="col" className="text-right">Bank (Livin&apos;)</th>
                  <th scope="col" className="text-right">Selisih</th>
                  <th scope="col" style={{ textAlign: 'center' }}>Status</th>
                  <th scope="col">Catatan Investigasi</th>
                  <th scope="col" className="text-center" style={{ width: 130 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isMatch = row.status === 'MATCH';
                  const isSelisih = row.status === 'SELISIH';
                  const isPending = row.status === 'PENDING';

                  return (
                    <tr key={row.reconDate}>
                      <td>
                        <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {row.reconDate}
                        </span>
                      </td>
                      <td className="text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {formatRupiah(row.systemQrisAmount)}
                      </td>
                      <td className="text-right" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {row.bankCreditAmount > 0 ? (
                          formatRupiah(row.bankCreditAmount)
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>Belum diisi</span>
                        )}
                      </td>
                      <td
                        className="text-right"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          color: isMatch
                            ? 'var(--color-success)'
                            : isSelisih
                            ? 'var(--color-error)'
                            : 'var(--color-text-muted)',
                        }}
                      >
                        {row.selisih > 0 ? `+${formatRupiah(row.selisih)}` : formatRupiah(row.selisih)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isMatch && (
                          <span className="badge badge-success" style={{ gap: 4 }}>
                            <CheckCircle2 size={12} /> MATCH
                          </span>
                        )}
                        {isSelisih && (
                          <span className="badge badge-error" style={{ gap: 4 }}>
                            <AlertTriangle size={12} /> SELISIH
                          </span>
                        )}
                        {isPending && (
                          <span className="badge badge-warning" style={{ gap: 4 }}>
                            <Clock size={12} /> PENDING
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: row.notes ? 'inherit' : 'var(--color-text-muted)' }}>
                        {row.notes || '—'}
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => openDetailModal(row.reconDate)}
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                        >
                          {row.bankCreditAmount > 0 ? 'Edit Bank' : 'Input Bank'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL INPUT & AUDIT PER TANGGAL */}
      {selectedDate && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 580,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <div
              className="card-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div>
                <h3 className="card-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                  Audit &amp; Rekonsiliasi QRIS
                </h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                  Tanggal Bisnis: {selectedDate}
                </span>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                className="btn btn-ghost btn-sm"
                style={{ padding: 4 }}
                aria-label="Tutup modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {detailLoading ? (
                <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                  <Loader2 size={28} className="animate-spin" style={{ margin: '0 auto' }} />
                  <p style={{ marginTop: 'var(--space-2)', fontSize: '0.85rem' }}>
                    Memeriksa rincian invoice QRIS kasir...
                  </p>
                </div>
              ) : (
                <>
                  {/* Status Banner Realtime */}
                  <div
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--color-surface-elevated, #f8fafc)',
                      border: '1px solid var(--color-border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Total QRIS di Aplikasi Kasir
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                        {formatRupiah(detail?.systemQrisAmount ?? 0)}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Status Verifikasi
                      </div>
                      <span className="badge badge-info" style={{ fontWeight: 600 }}>
                        {detail?.statusExisting || 'BARU'}
                      </span>
                    </div>
                  </div>

                  {/* Hourly Breakdown Transaksi QRIS Kasir */}
                  {detail && detail.breakdownPerJam.length > 0 && (
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                        Distribusi Jam Masuk QRIS Kasir:
                      </label>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--space-2)',
                          overflowX: 'auto',
                          paddingBottom: 6,
                        }}
                      >
                        {detail.breakdownPerJam.map((jam) => (
                          <div
                            key={jam.jam}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-md)',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'var(--color-surface)',
                              minWidth: 90,
                              textAlign: 'center',
                            }}
                          >
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                              {jam.jam}
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                              {formatRupiah(jam.totalQris)}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                              {jam.jumlahTx} trx
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Form Input Bank */}
                  <form onSubmit={handleSimpanRekonsiliasi} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div>
                      <label
                        htmlFor={bankInputId}
                        style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}
                      >
                        Nominal Mutasi Rekening Bank (Rp):
                      </label>
                      <input
                        id={bankInputId}
                        type="text"
                        placeholder="Contoh: 450000"
                        value={bankInput}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setBankInput(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="form-control"
                        style={{
                          width: '100%',
                          fontSize: '1.1rem',
                          fontWeight: 700,
                          padding: 'var(--space-3)',
                          fontFamily: 'var(--font-mono)',
                        }}
                        required
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Buka aplikasi Livin&apos; by Mandiri &rarr; Mutasi Rekening &rarr; Jumlahkan total kredit QRIS hari itu.
                      </span>
                    </div>

                    {/* Preview Selisih Real-Time */}
                    {bankInput && detail && (
                      <div
                        style={{
                          padding: 'var(--space-3)',
                          borderRadius: 'var(--radius-md)',
                          backgroundColor:
                            Math.abs(Number(bankInput.replace(/\D/g, '')) - detail.systemQrisAmount) <= 500
                              ? 'var(--color-success-light)'
                              : 'var(--color-error-light)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Perkiraan Selisih:</span>
                        <span
                          style={{
                            fontSize: '1rem',
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            color:
                              Math.abs(Number(bankInput.replace(/\D/g, '')) - detail.systemQrisAmount) <= 500
                                ? 'var(--color-success)'
                                : 'var(--color-error)',
                          }}
                        >
                          {formatRupiah(Number(bankInput.replace(/\D/g, '')) - detail.systemQrisAmount)}
                        </span>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor={notesInputId}
                        style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}
                      >
                        Catatan Investigasi / Keterangan:
                      </label>
                      <textarea
                        id={notesInputId}
                        rows={2}
                        placeholder="Misal: Mutasi kliring batch jam 23:50 masuk di hari berikutnya, atau nota ganda kasir."
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        className="form-control"
                        style={{ width: '100%', fontSize: '0.85rem' }}
                      />
                    </div>

                    {submitError && (
                      <div
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          backgroundColor: 'var(--color-error-light)',
                          color: 'var(--color-error)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.8rem',
                        }}
                      >
                        {submitError}
                      </div>
                    )}

                    {submitSuccess && (
                      <div
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          backgroundColor: 'var(--color-success-light)',
                          color: 'var(--color-success)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.8rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <CheckCircle2 size={16} /> Berhasil disimpan dan direkonsiliasi!
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedDate(null)}
                        className="btn btn-ghost"
                        disabled={submitting}
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={submitting}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {submitting ? (
                          <>
                            <Loader2 size={16} className="animate-spin" /> Menyimpan...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={16} /> Simpan Hasil Rekonsiliasi
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
