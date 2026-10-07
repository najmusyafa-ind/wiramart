'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  X,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Calendar,
  Banknote,
  QrCode,
  DollarSign,
  FileText,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

type ClosingPreview = {
  omzet: number;
  omzetCash: number;
  omzetQris: number;
  hppTerjual: number;
  labaKotor: number;
  biayaOperasional: number;
  labaBersih: number;
  totalCashDiscrepancy: number;
  selisihSeverity: 'HIJAU' | 'KUNING' | 'MERAH';
  activeShiftsCount: number;
  txCount: number;
};

type ClosingData = {
  id: string;
  closingDate: string;
  totalOmzet: string;
  omzetCash: string;
  omzetQris: string;
  totalHpp: string;
  grossProfit: string;
  operatingExpenses: string;
  cashDiscrepancy: string;
  netProfit: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

interface TutupBukuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  targetDate?: string;
}

function fmtRp(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return 'Rp 0';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return 'Rp ' + (isNaN(num) ? 0 : Math.round(num)).toLocaleString('id-ID');
}

export default function TutupBukuModal({
  isOpen,
  onClose,
  onSuccess,
  targetDate: initialDate,
}: TutupBukuModalProps) {
  const uid = useId();
  const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayWib);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [isLocked, setIsLocked] = useState(false);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [notes, setNotes] = useState('');

  const fetchStatus = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tutup-buku?date=${date}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setIsLocked(json.data.isLocked);
        setClosing(json.data.closing);
        setPreview(json.data.preview);
        setNotes(json.data.closing?.notes || '');
      } else {
        setError(json.error || 'Gagal memuat status tutup buku.');
      }
    } catch {
      setError('Kesalahan koneksi ke server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const dateToUse = initialDate || todayWib;
      setSelectedDate(dateToUse);
      fetchStatus(dateToUse);
    }
  }, [isOpen, initialDate, todayWib, fetchStatus]);

  async function handleKunciTutupBuku() {
    if (preview && preview.activeShiftsCount > 0) {
      setError(`Tidak dapat tutup buku: Masih ada ${preview.activeShiftsCount} shift kasir yang aktif.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/admin/tutup-buku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingDate: selectedDate,
          notes: notes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessMsg(json.message || 'Tutup Buku Harian berhasil dikunci!');
        fetchStatus(selectedDate);
        setTimeout(() => {
          onSuccess();
        }, 1200);
      } else {
        setError(json.error || 'Gagal melakukan tutup buku harian.');
      }
    } catch {
      setError('Terjadi kesalahan jaringan.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
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
          maxWidth: 520,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="card-header"
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isLocked
              ? 'linear-gradient(135deg, hsl(142, 60%, 96%) 0%, hsl(142, 50%, 92%) 100%)'
              : 'linear-gradient(135deg, hsl(220, 80%, 97%) 0%, hsl(220, 70%, 94%) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: isLocked ? 'var(--color-success)' : 'var(--color-primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isLocked ? <ShieldCheck size={20} /> : <Lock size={20} />}
            </div>
            <div>
              <h2
                id={`${uid}-title`}
                style={{
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--weight-bold)',
                  margin: 0,
                  color: 'var(--color-text)',
                }}
              >
                {isLocked ? 'Tutup Buku Terkunci (Locked)' : 'Tutup Buku Finansial Harian'}
              </h2>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                Penguncian Laporan &amp; Audit Toko (Manager/Dosen)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: 4,
            }}
            aria-label="Tutup modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Tanggal Selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-elevated)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
              Tanggal Bisnis:
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                fetchStatus(e.target.value);
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
              }}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto' }} />
              <p style={{ marginTop: 8, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Menghitung data harian...</p>
            </div>
          ) : (
            <>
              {/* Alert Status */}
              {isLocked ? (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(142, 70%, 94%)',
                  border: '1.5px solid hsl(142, 65%, 75%)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <CheckCircle2 size={20} style={{ color: 'hsl(142, 70%, 35%)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'hsl(142, 70%, 25%)' }}>
                      Periode Tanggal Ini Sudah Ditutup &amp; Terkunci
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'hsl(142, 70%, 30%)', marginTop: 2 }}>
                      Transaksi dan data keuangan tanggal ini tidak dapat di-void atau diubah. Seluruh angka resmi telah dibekukan dalam buku besar.
                    </div>
                  </div>
                </div>
              ) : preview && preview.activeShiftsCount > 0 ? (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(38, 95%, 94%)',
                  border: '1.5px solid hsl(38, 90%, 75%)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <AlertTriangle size={20} style={{ color: 'hsl(38, 95%, 35%)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'hsl(38, 95%, 25%)' }}>
                      Perhatian: Ada {preview.activeShiftsCount} Shift Kasir yang Masih Aktif!
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'hsl(38, 95%, 30%)', marginTop: 2 }}>
                      Kasir harus menutup shift (rekap fisik laci) terlebih dahulu sebelum Manager dapat mengunci Tutup Buku.
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Rincian Angka Finansial */}
              {preview && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Total Omzet</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-primary)', marginTop: 2 }}>
                      {fmtRp(preview.omzet)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Cash: {fmtRp(preview.omzetCash)} | QRIS: {fmtRp(preview.omzetQris)}
                    </div>
                  </div>

                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Laba Kotor</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: 'hsl(142, 70%, 35%)', marginTop: 2 }}>
                      {fmtRp(preview.labaKotor)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      HPP Terjual: {fmtRp(preview.hppTerjual)}
                    </div>
                  </div>

                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Biaya Operasional</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: preview.biayaOperasional > 0 ? 'var(--color-error)' : 'var(--color-text)', marginTop: 2 }}>
                      {fmtRp(preview.biayaOperasional)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Listrik / Plastik / dll
                    </div>
                  </div>

                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Laba Bersih Final</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--color-success)', marginTop: 2 }}>
                      {fmtRp(preview.labaBersih)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Laba Kotor − Biaya
                    </div>
                  </div>
                </div>
              )}

              {/* Status Audit Selisih Kas Laci (K7) */}
              {preview && (
                <div style={{
                  background: preview.selisihSeverity === 'MERAH'
                    ? 'hsl(0, 90%, 96%)'
                    : preview.selisihSeverity === 'KUNING'
                    ? 'hsl(38, 90%, 95%)'
                    : 'hsl(142, 70%, 96%)',
                  border: `1.5px solid ${
                    preview.selisihSeverity === 'MERAH'
                      ? 'hsl(0, 80%, 75%)'
                      : preview.selisihSeverity === 'KUNING'
                      ? 'hsl(38, 80%, 75%)'
                      : 'hsl(142, 60%, 75%)'
                  }`,
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                      Audit Selisih Kas Laci (Toleransi K7)
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, marginTop: 2 }}>
                      {preview.totalCashDiscrepancy === 0
                        ? 'Rp 0 (Pas Sempurna)'
                        : preview.totalCashDiscrepancy > 0
                        ? `+${fmtRp(preview.totalCashDiscrepancy)} (Lebih)`
                        : `${fmtRp(preview.totalCashDiscrepancy)} (Tekor)`}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: preview.selisihSeverity === 'MERAH'
                      ? 'var(--color-error)'
                      : preview.selisihSeverity === 'KUNING'
                      ? 'var(--color-warning)'
                      : 'var(--color-success)',
                    color: 'white',
                  }}>
                    {preview.selisihSeverity === 'MERAH'
                      ? '🔴 Tekor Berat (> 20k)'
                      : preview.selisihSeverity === 'KUNING'
                      ? '🟡 Tekor Sedang'
                      : '🟢 Wajar (≤ 2.000)'}
                  </span>
                </div>
              )}

              {/* Form Catatan Manager */}
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  Catatan Evaluasi Manager / Dosen:
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Shift 1 & 2 selesai tepat waktu, uang setoran Rp 320.000 sudah diserahkan ke bendahara."
                  disabled={isLocked}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {error && (
                <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)', fontWeight: 600, background: 'var(--color-error-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                  ⚠️ {error}
                </div>
              )}

              {successMsg && (
                <div style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', fontWeight: 700, background: 'var(--color-success-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                  ✔ {successMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            background: 'var(--color-surface)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={submitting}
          >
            Tutup
          </button>
          {!isLocked && (
            <button
              type="button"
              onClick={handleKunciTutupBuku}
              className="btn btn-primary btn-sm"
              disabled={submitting || loading || (preview?.activeShiftsCount ?? 0) > 0}
              style={{
                background: 'hsl(142, 70%, 35%)',
                borderColor: 'hsl(142, 70%, 30%)',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="spin-icon" />
                  Mengunci...
                </>
              ) : (
                <>
                  <Lock size={14} />
                  Kunci &amp; Tutup Buku Hari Ini
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
