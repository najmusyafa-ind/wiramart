'use client';

import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Clock,
  Loader2,
  QrCode,
  Receipt,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';

type MonitoredShift = {
  shiftId: string;
  dateWib: string;
  sessionLabel: string;
  kasirName: string;
  status: string;
  clockIn: string;
  clockOut: string | null;
  modalAwal: number;
  txCount: number;
  voidCount: number;
  omzetCash: number;
  omzetQris: number;
  omzetTotal: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number | null;
  actualCash: number | null;
  discrepancy: number | null;
  notes: string | null;
};

type MonitoredTx = {
  id: string;
  invoiceNumber: string;
  shiftId: string | null;
  sessionLabel: string;
  kasirName: string;
  paymentMethod: string;
  grossAmount: number;
  status: string;
  voidReason: string | null;
  createdAt: string;
  ageMinutes: number;
  canVoid: boolean;
};

type MonitorPayload = {
  mode: 'today' | 'my_7d';
  todayWib: string;
  isManager: boolean;
  voidPolicy: {
    windowMinutes: number;
    dailyLimit: number | null;
    usedToday: number;
    remainingToday: number | null;
  };
  shifts: MonitoredShift[];
  transactions: MonitoredTx[];
};

const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

function fmtTimeWib(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateShortWib(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
  });
}

export default function ShiftMonitorWidget() {
  const uid = useId();
  const [mode, setMode] = useState<'today' | 'my_7d'>('today');
  const [reloadTick, setReloadTick] = useState(0);
  const requestKey = `${mode}:${reloadTick}`;
  const [loadedState, setLoadedState] = useState<{
    key: string;
    data: MonitorPayload | null;
    error: string;
  } | null>(null);

  const loading = !loadedState || loadedState.key !== requestKey;
  const data = loadedState?.data ?? null;
  const error = loadedState?.key === requestKey ? loadedState.error : '';

  // Modal VOID cepat (<= 10 menit untuk Admin Shift)
  const [voidTarget, setVoidTarget] = useState<MonitoredTx | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidErr, setVoidErr] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const key = requestKey;
    fetch(`/api/admin/shift-monitor?mode=${mode}`, { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as { success?: boolean; data?: MonitorPayload; error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok || !json.success || !json.data) {
          setLoadedState((prev) => ({
            key,
            data: prev?.data ?? null,
            error: typeof json.error === 'string' ? json.error : 'Gagal memuat pantauan shift.',
          }));
          return;
        }
        setLoadedState({ key, data: json.data, error: '' });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setLoadedState((prev) => ({
            key,
            data: prev?.data ?? null,
            error: 'Koneksi terganggu saat memuat data shift.',
          }));
        }
      });
    return () => controller.abort();
  }, [mode, requestKey]);

  async function handleConfirmVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voidTarget) return;
    const minLen = data?.isManager ? 5 : 10;
    if (voidReason.trim().length < minLen) {
      setVoidErr(`Alasan wajib diisi minimal ${minLen} karakter.`);
      return;
    }
    setVoiding(true);
    setVoidErr('');
    try {
      const res = await fetch(`/api/admin/transaksi/${voidTarget.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alasan: voidReason.trim() }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string; data?: { message?: string } };
      if (!res.ok || !json.success) {
        setVoidErr(typeof json.error === 'string' ? json.error : 'Gagal membatalkan transaksi.');
        return;
      }
      setVoidTarget(null);
      setVoidReason('');
      setToast(json.data?.message ?? `Transaksi ${voidTarget.invoiceNumber} berhasil di-VOID.`);
      setReloadTick((t) => t + 1);
      setTimeout(() => setToast(''), 5000);
    } catch {
      setVoidErr('Koneksi terputus saat memproses VOID.');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }} aria-labelledby={`${uid}-title`}>
      {/* Header */}
      <div
        className="card-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h2
            id={`${uid}-title`}
            className="card-title"
            style={{ fontSize: '0.94rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}
          >
            <Receipt size={16} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
            <span>Pantauan Shift Pagi/Siang &amp; Riwayat Transaksi</span>
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
            Modal awal, omzet kasir per shift, dan pembatalan cepat (VOID &le; 10 menit
            {data && data.voidPolicy.remainingToday !== null
              ? ` · sisa kuota hari ini: ${data.voidPolicy.remainingToday}/${data.voidPolicy.dailyLimit}`
              : ''}
            ). Laba &amp; bagi hasil tetap khusus Manager.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div role="tablist" aria-label="Filter pantauan shift" style={{ display: 'inline-flex', background: 'var(--color-surface-alt)', padding: 3, borderRadius: 9, border: '1px solid var(--color-border)' }}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'today'}
              onClick={() => setMode('today')}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'today' ? 'var(--color-primary)' : 'transparent',
                color: mode === 'today' ? '#ffffff' : 'var(--color-text-muted)',
              }}
            >
              Hari Ini (Pagi &amp; Siang)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'my_7d'}
              onClick={() => setMode('my_7d')}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'my_7d' ? 'var(--color-primary)' : 'transparent',
                color: mode === 'my_7d' ? '#ffffff' : 'var(--color-text-muted)',
              }}
            >
              7 Hari Shift Saya
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            disabled={loading}
            aria-label="Muat ulang pantauan shift"
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: '#ffffff',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {toast && (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              borderRadius: 9,
              background: 'hsl(142 76% 94%)',
              border: '1px solid hsl(142 55% 74%)',
              color: 'hsl(142 72% 24%)',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {toast}
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert" style={{ margin: 0 }}>
            {error}
          </div>
        )}

        {loading && !data ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={18} className="spin-icon" aria-hidden="true" />
            <span style={{ fontSize: '0.82rem' }}>Memuat data shift operasional...</span>
          </div>
        ) : !data || data.shifts.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
            {mode === 'today'
              ? 'Belum ada shift kasir yang dibuka hari ini.'
              : 'Belum ada riwayat shift yang tercatat atas nama Anda dalam 7 hari terakhir.'}
          </div>
        ) : (
          <>
            {/* Kartu Per Shift (Shift Pagi / Shift Siang) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))', gap: 10 }}>
              {data.shifts.map((sh) => {
                const isClosed = sh.status === 'CLOSED';
                const disc = sh.discrepancy ?? 0;
                return (
                  <div
                    key={sh.shiftId}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      background: isClosed ? '#ffffff' : 'hsl(142 76% 98%)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            background: sh.sessionLabel === 'Shift Pagi' ? 'hsl(38 92% 92%)' : 'hsl(214 95% 92%)',
                            color: sh.sessionLabel === 'Shift Pagi' ? 'hsl(28 84% 28%)' : 'hsl(221 76% 32%)',
                          }}
                        >
                          {sh.sessionLabel}
                        </span>
                        {mode === 'my_7d' && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                            {fmtDateShortWib(sh.clockIn)}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: isClosed ? 'hsl(210 20% 93%)' : 'hsl(142 76% 90%)',
                          color: isClosed ? 'hsl(215 24% 34%)' : 'hsl(142 72% 24%)',
                        }}
                      >
                        {isClosed ? `Tutup ${sh.clockOut ? fmtTimeWib(sh.clockOut) : ''}` : `Aktif sejak ${fmtTimeWib(sh.clockIn)}`}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-text)' }}>
                      Kasir: {sh.kasirName}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.75rem' }}>
                      <div style={{ background: 'var(--color-surface-alt)', padding: '6px 8px', borderRadius: 7 }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>Modal Awal</div>
                        <div style={{ fontWeight: 800 }}>{rp(sh.modalAwal)}</div>
                      </div>
                      <div style={{ background: 'var(--color-surface-alt)', padding: '6px 8px', borderRadius: 7 }}>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>Omzet ({sh.txCount} trx)</div>
                        <div style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{rp(sh.omzetTotal)}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Banknote size={12} aria-hidden="true" /> Tunai: <strong>{rp(sh.omzetCash)}</strong>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <QrCode size={12} aria-hidden="true" /> QRIS: <strong>{rp(sh.omzetQris)}</strong>
                      </span>
                      {(sh.cashOut > 0 || sh.cashIn > 0) && (
                        <span>
                          Kas Gerak: +{rp(sh.cashIn)} / -{rp(sh.cashOut)}
                        </span>
                      )}
                    </div>

                    {isClosed && sh.actualCash !== null ? (
                      <div
                        style={{
                          padding: '6px 8px',
                          borderRadius: 7,
                          fontSize: '0.73rem',
                          fontWeight: 700,
                          background: Math.abs(disc) <= 2000 ? 'hsl(142 76% 94%)' : disc < 0 ? 'hsl(0 86% 95%)' : 'hsl(38 92% 94%)',
                          color: Math.abs(disc) <= 2000 ? 'hsl(142 72% 24%)' : disc < 0 ? 'hsl(0 72% 36%)' : 'hsl(28 84% 28%)',
                        }}
                      >
                        Fisik Laci: {rp(sh.actualCash)} ·{' '}
                        {Math.abs(disc) <= 2000
                          ? 'Sesuai'
                          : disc < 0
                          ? `Kurang ${rp(Math.abs(disc))}`
                          : `Lebih ${rp(disc)}`}
                      </div>
                    ) : !isClosed ? (
                      <div style={{ fontSize: '0.71rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        Target laci disembunyikan selama shift aktif (Blind Count).
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Tabel Riwayat Transaksi Shift */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>
                Riwayat Transaksi ({data.transactions.length})
              </div>
              {data.transactions.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Belum ada transaksi tercatat pada shift ini.
                </div>
              ) : (
                <div className="table-wrapper" style={{ maxHeight: 340, overflow: 'auto' }}>
                  <table className="table" style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        <th scope="col">Waktu</th>
                        <th scope="col">Shift</th>
                        <th scope="col">Invoice</th>
                        <th scope="col">Kasir</th>
                        <th scope="col">Metode</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Nominal</th>
                        <th scope="col">Status</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>
                            {mode === 'my_7d' ? `${fmtDateShortWib(tx.createdAt)} ` : ''}
                            {fmtTimeWib(tx.createdAt)}
                          </td>
                          <td>{tx.sessionLabel}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{tx.invoiceNumber}</td>
                          <td>{tx.kasirName}</td>
                          <td>{tx.paymentMethod}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{rp(tx.grossAmount)}</td>
                          <td>
                            {tx.status === 'VOID' ? (
                              <span style={{ color: 'var(--color-error)', fontWeight: 700 }} title={tx.voidReason ?? ''}>
                                VOID
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>SELESAI</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {tx.canVoid ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidTarget(tx);
                                  setVoidReason('');
                                  setVoidErr('');
                                }}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: 6,
                                  border: '1px solid hsl(0 70% 80%)',
                                  background: 'hsl(0 86% 96%)',
                                  color: 'hsl(0 72% 38%)',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                VOID ({10 - tx.ageMinutes > 0 && !data.isManager ? `${10 - tx.ageMinutes}m` : 'Batal'})
                              </button>
                            ) : tx.status === 'COMPLETED' ? (
                              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Clock size={11} aria-hidden="true" /> &gt;{data.voidPolicy.windowMinutes}m
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal VOID Cepat */}
      {voidTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-void-title`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !voiding) setVoidTarget(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, borderRadius: 14 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 id={`${uid}-void-title`} style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldAlert size={16} aria-hidden="true" /> Batalkan Transaksi (VOID Cepat)
              </h3>
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                disabled={voiding}
                aria-label="Tutup modal void"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleConfirmVoid} className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--color-surface-alt)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Invoice</span><strong>{voidTarget.invoiceNumber}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Nominal</span><strong>{rp(voidTarget.grossAmount)} ({voidTarget.paymentMethod})</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Kasir</span><span>{voidTarget.kasirName}</span>
                </div>
              </div>

              <div style={{ padding: 10, borderRadius: 8, background: 'hsl(38 92% 95%)', color: 'hsl(28 84% 28%)', fontSize: '0.75rem', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <span>Stok produk akan otomatis dikembalikan dan tindakan ini tercatat permanen di log audit Manager.</span>
              </div>

              <div>
                <label className="form-label" htmlFor={`${uid}-void-reason`}>
                  Alasan Pembatalan <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <textarea
                  id={`${uid}-void-reason`}
                  className="form-input form-textarea"
                  rows={3}
                  value={voidReason}
                  onChange={(e) => {
                    setVoidReason(e.target.value);
                    setVoidErr('');
                  }}
                  placeholder="Contoh: Salah input qty Body Mist 3 pcs seharusnya 2 pcs karena lag"
                  maxLength={300}
                  required
                />
                {voidErr && (
                  <p role="alert" style={{ color: 'var(--color-error)', fontSize: '0.76rem', margin: '4px 0 0' }}>
                    {voidErr}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary" disabled={voiding} onClick={() => setVoidTarget(null)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-danger" disabled={voiding}>
                  {voiding ? 'Memproses...' : 'Konfirmasi VOID'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
