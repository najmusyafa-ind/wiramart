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
  Sun,
  Sunset,
  User,
  Clock,
  PackageCheck,
  Trash2,
  Stamp,
} from 'lucide-react';

type ShiftReportItem = {
  shiftId: string;
  shiftName: string; // 'Shift 1 (Pagi)' | 'Shift 2 (Siang)'
  employeeId: string;
  employeeName: string;
  employeeNim: string;
  status: 'ACTIVE' | 'CLOSED';
  clockIn: string;
  clockOut: string | null;
  modalAwal: number;
  cashSales: number;
  qrisSales: number;
  totalOmzet: number;
  txCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number | null;
  selisih: number | null;
  auditFlags: string | null;
  notes: string | null;
};

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

export type StockMutationSummary = {
  date: string;
  itemsReceived: { totalQty: number; totalHpp: number; draftCount: number };
  itemsSold: { totalQty: number; totalGrossAmount: number; discountedItemsQty: number };
  fefoActions: { activeDiscountsCount: number; destroyedQty: number; returnedQty: number };
  generatedAt: string;
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
  modSignedBy?: string | null;
  modSignedAt?: string | null;
  modSignNote?: string | null;
  stockMutationSummary?: StockMutationSummary | null;
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

function fmtTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '-';
  }
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
  const [shiftsData, setShiftsData] = useState<ShiftReportItem[]>([]);
  const [notes, setNotes] = useState('');

  // MOD Sign-off & Stock Mutation State (Fase 4)
  const [stockMutation, setStockMutation] = useState<StockMutationSummary | null>(null);
  const [loadingMutation, setLoadingMutation] = useState(false);
  const [modSignNote, setModSignNote] = useState('');
  const [signingOff, setSigningOff] = useState(false);
  const [signOffSuccess, setSignOffSuccess] = useState<string | null>(null);

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
        setShiftsData(json.data.shifts || []);
        setNotes(json.data.closing?.notes || '');
        if (json.data.closing?.modSignNote) {
          setModSignNote(json.data.closing.modSignNote);
        }
        if (json.data.closing?.stockMutationSummary) {
          setStockMutation(json.data.closing.stockMutationSummary);
        }
      } else {
        setError(json.error || 'Gagal memuat status tutup buku.');
      }
    } catch {
      setError('Kesalahan koneksi ke server.');
    } finally {
      setLoading(false);
    }

    // Ambil mutasi stok terkini jika belum tersimpan di closing
    setLoadingMutation(true);
    try {
      const mutRes = await fetch(`/api/admin/tutup-buku/sign-off?date=${date}`);
      const mutJson = await mutRes.json();
      if (mutRes.ok && mutJson.success && mutJson.data?.summary) {
        setStockMutation((prev) => prev || mutJson.data.summary);
      }
    } catch {
      // silent
    } finally {
      setLoadingMutation(false);
    }
  }, []);

  async function handleSignOffMOD() {
    setSigningOff(true);
    setError(null);
    setSignOffSuccess(null);
    try {
      const res = await fetch('/api/admin/tutup-buku/sign-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingDate: selectedDate,
          notes: modSignNote.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSignOffSuccess(json.message || 'Daily Closing berhasil disahkan oleh Manager on Duty!');
        fetchStatus(selectedDate);
      } else {
        setError(json.error || 'Gagal mengesahkan Daily Closing.');
      }
    } catch {
      setError('Terjadi kesalahan jaringan.');
    } finally {
      setSigningOff(false);
    }
  }

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
          maxWidth: 580,
          maxHeight: '94vh',
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

              {/* ── BAGIAN 1: Rincian Laci Per-Shift (Modal Rp 100k Absolut) ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    1. Rincian Laci Per-Shift (Modal Rp 100k Absolut)
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    {shiftsData.length} Sesi Terdeteksi
                  </span>
                </div>

                {shiftsData.length === 0 ? (
                  <div style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface-elevated)',
                    border: '1px dashed var(--color-border)',
                    textAlign: 'center',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                  }}>
                    Belum ada sesi shift kasir yang tercatat pada tanggal ini.
                  </div>
                ) : (
                  shiftsData.map((sh) => {
                    const isShiftPagi = sh.shiftName.includes('Pagi');
                    return (
                      <div
                        key={sh.shiftId}
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-surface)',
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                        }}
                      >
                        {/* Shift Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isShiftPagi ? (
                              <Sun size={15} style={{ color: 'hsl(38, 95%, 45%)' }} />
                            ) : (
                              <Sunset size={15} style={{ color: 'hsl(28, 95%, 45%)' }} />
                            )}
                            <span style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--color-text)' }}>
                              {sh.shiftName}
                            </span>
                            <span style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full)',
                              background: sh.status === 'CLOSED' ? 'hsl(142, 60%, 92%)' : 'hsl(38, 90%, 90%)',
                              color: sh.status === 'CLOSED' ? 'hsl(142, 70%, 25%)' : 'hsl(38, 90%, 25%)',
                            }}>
                              {sh.status === 'CLOSED' ? 'TUTUP SHIFT' : 'MASIH AKTIF'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} />
                            {fmtTimeOnly(sh.clockIn)} – {fmtTimeOnly(sh.clockOut)} WIB
                          </div>
                        </div>

                        {/* Kasir Identity */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                          <User size={13} style={{ color: 'var(--color-primary)' }} />
                          <span>Kasir: <strong>{sh.employeeName}</strong> ({sh.employeeNim})</span>
                        </div>

                        {/* Breakdown Angka Laci Shift */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 6,
                          background: 'var(--color-surface-elevated)',
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.7rem',
                        }}>
                          <div>
                            <div style={{ color: 'var(--color-text-muted)' }}>Modal Laci:</div>
                            <div style={{ fontWeight: 700 }}>{fmtRp(sh.modalAwal)}</div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--color-text-muted)' }}>Penjualan Cash:</div>
                            <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{fmtRp(sh.cashSales)}</div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--color-text-muted)' }}>Penjualan QRIS:</div>
                            <div style={{ fontWeight: 700, color: 'hsl(260, 70%, 45%)' }}>{fmtRp(sh.qrisSales)}</div>
                          </div>
                        </div>

                        {/* Petty Cash & Expected vs Actual */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.72rem',
                          borderTop: '1px dashed var(--color-border)',
                          paddingTop: 6,
                        }}>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Petty Cash: </span>
                            {sh.cashOut > 0 ? (
                              <span style={{ color: 'var(--color-error)', fontWeight: 600 }}>Keluar -{fmtRp(sh.cashOut)} </span>
                            ) : null}
                            {sh.cashIn > 0 ? (
                              <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>Masuk +{fmtRp(sh.cashIn)} </span>
                            ) : null}
                            {sh.cashOut === 0 && sh.cashIn === 0 ? <span>Rp 0</span> : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>
                              Seharusnya: <strong>{fmtRp(sh.expectedCash)}</strong> | Fisik:
                            </span>
                            <strong style={{ color: 'var(--color-text)' }}>
                              {sh.actualCash !== null ? fmtRp(sh.actualCash) : 'Belum dihitung'}
                            </strong>
                            {sh.selisih !== null && (
                              <span style={{
                                fontWeight: 800,
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-sm)',
                                background: sh.selisih === 0
                                  ? 'hsl(142, 60%, 92%)'
                                  : sh.selisih > 0
                                  ? 'hsl(200, 80%, 92%)'
                                  : 'hsl(0, 90%, 92%)',
                                color: sh.selisih === 0
                                  ? 'hsl(142, 70%, 35%)'
                                  : sh.selisih > 0
                                  ? 'hsl(200, 80%, 35%)'
                                  : 'var(--color-error)',
                              }}>
                                {sh.selisih === 0 ? '✓ Pas' : (sh.selisih > 0 ? `+${fmtRp(sh.selisih)} (Lebih)` : `${fmtRp(sh.selisih)} (Tekor)`)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* ── BAGIAN 2: Penggabungan Konsolidasi Toko (Jam 15:00 WIB) ── */}
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>
                2. Penggabungan Konsolidasi Toko (Jam 15:00 WIB)
              </div>

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

              {/* ── BAGIAN 3: Rekonsiliasi Mutasi Stok & Pengesahan MOD (Fase 4) ── */}
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 10 }}>
                3. Rekonsiliasi Mutasi Stok &amp; Pengesahan MOD (Fase 4)
              </div>

              {/* Kartu Ringkasan Mutasi Stok */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: 10 }}>
                  <div style={{ fontSize: '0.7rem', color: '#166534', textTransform: 'uppercase', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <PackageCheck size={13} /> Barang Masuk ACC
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#15803d', marginTop: 3 }}>
                    {stockMutation?.itemsReceived.totalQty ?? 0} pcs
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#4b5563', marginTop: 2 }}>
                    Nilai HPP: {fmtRp(stockMutation?.itemsReceived.totalHpp ?? 0)} ({stockMutation?.itemsReceived.draftCount ?? 0} kiriman)
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', padding: 10 }}>
                  <div style={{ fontSize: '0.7rem', color: '#1e40af', textTransform: 'uppercase', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrendingUp size={13} /> Terjual di Kasir
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#1d4ed8', marginTop: 3 }}>
                    {stockMutation?.itemsSold.totalQty ?? 0} pcs
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#4b5563', marginTop: 2 }}>
                    Termasuk {stockMutation?.itemsSold.discountedItemsQty ?? 0} pcs Obral Diskon
                  </div>
                </div>

                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--radius-md)', padding: 10 }}>
                  <div style={{ fontSize: '0.7rem', color: '#9a3412', textTransform: 'uppercase', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Trash2 size={13} /> FEFO Write-Off/Retur
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#c2410c', marginTop: 3 }}>
                    {(stockMutation?.fefoActions.destroyedQty ?? 0) + (stockMutation?.fefoActions.returnedQty ?? 0)} pcs
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#4b5563', marginTop: 2 }}>
                    Musnah: {stockMutation?.fefoActions.destroyedQty ?? 0} | Retur: {stockMutation?.fefoActions.returnedQty ?? 0}
                  </div>
                </div>
              </div>

              {/* Status Pengesahan Stempel MOD */}
              {closing?.status === 'AUDITED' || closing?.modSignedAt ? (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(142, 70%, 94%)',
                  border: '1.5px solid hsl(142, 65%, 70%)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldCheck size={18} color="#15803d" />
                    <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#14532d', textTransform: 'uppercase' }}>
                      Status: AUDITED (Telah Disahkan Manager on Duty)
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: 2 }}>
                    Disahkan pada: {closing.modSignedAt ? new Date(closing.modSignedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'}
                  </div>
                  {closing.modSignNote && (
                    <div style={{ fontSize: '0.75rem', color: '#14532d', background: '#dcfce7', padding: '6px 10px', borderRadius: 6, marginTop: 4 }}>
                      <strong>Catatan MOD:</strong> &quot;{closing.modSignNote}&quot;
                    </div>
                  )}
                </div>
              ) : isLocked ? (
                <div style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: '#fefce8',
                  border: '1.5px solid #fef08a',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Stamp size={18} color="#ca8a04" />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 900, color: '#854d0e' }}>
                        Wewenang Pengesahan Akhir: Manager on Duty (MOD)
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#a16207' }}>
                        Periksa kecocokan uang kas dan ringkasan mutasi stok di atas sebelum mengesahkan closing harian.
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#713f12', display: 'block', marginBottom: 4 }}>
                      Catatan Pengesahan MOD (Opsional):
                    </label>
                    <input
                      type="text"
                      value={modSignNote}
                      onChange={(e) => setModSignNote(e.target.value)}
                      placeholder="Contoh: Stok fisik dan uang kas sesuai, disahkan oleh Dosen MOD."
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: '1px solid #fde047',
                        fontSize: '0.78rem',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {signOffSuccess && (
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '6px 10px', borderRadius: 6 }}>
                      {signOffSuccess}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      disabled={signingOff}
                      onClick={handleSignOffMOD}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#ca8a04',
                        color: '#ffffff',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 2px 6px rgba(202, 138, 4, 0.25)',
                      }}
                    >
                      {signingOff ? (
                        <>
                          <Loader2 size={14} className="spin-icon" />
                          Mengesahkan...
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={15} />
                          Sahkan Laporan Hari Ini (Stempel MOD)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : null}

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
