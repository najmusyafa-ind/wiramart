'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Clock, Send, ChevronLeft, CheckCircle, XCircle, Loader2, Calendar, AlertTriangle, RefreshCw } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────
type JadwalSaya = {
  id: string;
  dayOfWeek: string;
  slotStart: string;
  slotEnd: string;
};

type SlotTersedia = {
  id: string;
  dayOfWeek: string;
  slotStart: string;
  slotEnd: string;
  employeeId: string;
  employeeName: string;
  employeeNim: string;
};

type SwapRequest = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  createdAt: string;
  fromSchedule: { dayOfWeek: string; slotStart: string; slotEnd: string };
  toSchedule: { dayOfWeek: string; slotStart: string; slotEnd: string };
};

// ── Helpers ──────────────────────────────────────────────────────────────
const HARI_ORDER: Record<string, number> = {
  SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, SABTU: 6, MINGGU: 7,
};

function formatShiftLabel(day: string, start: string, end: string) {
  const jam = `${start.slice(0, 5)}–${end.slice(0, 5)}`;
  return `${day.charAt(0) + day.slice(1).toLowerCase()}, ${jam}`;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  PENDING:  { bg: 'hsl(45 90% 55% / 0.12)',  color: 'hsl(40 85% 40%)',  label: 'Menunggu' },
  APPROVED: { bg: 'hsl(142 70% 45% / 0.12)', color: 'hsl(142 55% 35%)', label: 'Disetujui' },
  REJECTED: { bg: 'hsl(0 72% 51% / 0.12)',   color: 'hsl(0 65% 42%)',   label: 'Ditolak' },
};

// ── Main Page ─────────────────────────────────────────────────────────────
export default function TukarShiftPage() {
  const [jadwalSaya, setJadwalSaya] = useState<JadwalSaya[]>([]);
  const [slotTersedia, setSlotTersedia] = useState<SlotTersedia[]>([]);
  const [history, setHistory] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [jadwalRes, historyRes] = await Promise.all([
        fetch('/api/kasir/jadwal-saya'),
        fetch('/api/kasir/swap-request'),
      ]);
      const jadwalJson = await jadwalRes.json() as { data?: { jadwalSaya: JadwalSaya[]; slotTersedia: SlotTersedia[] } };
      const historyJson = await historyRes.json() as { data?: SwapRequest[] };

      if (jadwalJson.data) {
        const sorted = [...jadwalJson.data.jadwalSaya].sort(
          (a, b) => (HARI_ORDER[a.dayOfWeek] ?? 9) - (HARI_ORDER[b.dayOfWeek] ?? 9),
        );
        setJadwalSaya(sorted);
        setSlotTersedia(jadwalJson.data.slotTersedia);
        if (sorted.length > 0) setFromId(sorted[0]!.id);
      }
      if (historyJson.data) setHistory(historyJson.data);
    } catch {
      // Gagal load — kasir mungkin belum login, redirect akan terjadi otomatis
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId || !toId || reason.trim().length < 10) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/kasir/swap-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromScheduleId: fromId, toScheduleId: toId, reason: reason.trim() }),
      });
      const json = await res.json() as { data?: { message: string }; error?: string };
      if (res.ok) {
        setToast({ msg: json.data?.message ?? 'Pengajuan berhasil dikirim!', ok: true });
        setReason('');
        setToId('');
        void fetchAll();
      } else {
        setToast({ msg: json.error ?? 'Gagal mengirim pengajuan.', ok: false });
      }
    } catch {
      setToast({ msg: 'Gagal terhubung ke server.', ok: false });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  // Filter slot tujuan: exclude slot yang sama dengan jadwal kita sendiri
  const myScheduleIds = new Set(jadwalSaya.map(j => j.id));
  const filteredSlot = slotTersedia.filter(s => !myScheduleIds.has(s.id));

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', padding: '0 0 64px' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: toast.ok ? 'hsl(142 60% 35%)' : 'hsl(0 65% 42%)',
          color: '#fff', padding: '10px 20px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)', fontSize: 14, fontWeight: 600,
          whiteSpace: 'nowrap', animation: 'fade-in 0.2s ease',
        }}>
          {toast.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{
        background: 'var(--color-sidebar)',
        borderBottom: '1px solid var(--color-sidebar-border)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <a href="/kasir/pos" aria-label="Kembali ke POS" style={{ color: 'var(--color-sidebar-muted)', display: 'flex' }}>
          <ChevronLeft size={20} />
        </a>
        <ArrowLeftRight size={18} style={{ color: 'var(--color-primary)' }} />
        <div>
          <h1 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: 'var(--color-sidebar-fg)', margin: 0 }}>
            Ajukan Tukar Shift
          </h1>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-sidebar-muted)', margin: 0 }}>
            Pengajuan akan dikonfirmasi oleh Admin
          </p>
        </div>
        <button
          onClick={() => void fetchAll()}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-sidebar-muted)', cursor: 'pointer', padding: 4 }}
          aria-label="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 'var(--text-sm)' }}>Memuat data jadwal...</p>
          </div>
        ) : (
          <>
            {/* Jadwal kamu */}
            <section className="card">
              <div className="card-body" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
                  <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                    Jadwal Shift Kamu
                  </h2>
                </div>
                {jadwalSaya.length === 0 ? (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
                    Kamu belum memiliki jadwal shift. Hubungi Admin.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {jadwalSaya.map(j => (
                      <span key={j.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'hsl(142 70% 45% / 0.12)',
                        color: 'hsl(142 55% 35%)',
                        padding: '4px 12px', borderRadius: '999px',
                        fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                      }}>
                        <Clock size={11} />
                        {formatShiftLabel(j.dayOfWeek, j.slotStart, j.slotEnd)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Form pengajuan */}
            {jadwalSaya.length > 0 ? (
              <section className="card">
                <div className="card-body" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <ArrowLeftRight size={16} style={{ color: 'var(--color-primary)' }} />
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                      Ajukan Pertukaran
                    </h2>
                  </div>

                  <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Dari jadwal mana */}
                    <div>
                      <label className="form-label" htmlFor="from-schedule">
                        Jadwal yang ingin kamu tukar *
                      </label>
                      <select
                        id="from-schedule"
                        className="form-input"
                        value={fromId}
                        onChange={e => setFromId(e.target.value)}
                        required
                      >
                        {jadwalSaya.map(j => (
                          <option key={j.id} value={j.id}>
                            {formatShiftLabel(j.dayOfWeek, j.slotStart, j.slotEnd)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Ke jadwal mana */}
                    <div>
                      <label className="form-label" htmlFor="to-schedule">
                        Jadwal tujuan (dari karyawan lain) *
                      </label>
                      {filteredSlot.length === 0 ? (
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                          Tidak ada slot tersedia saat ini.
                        </p>
                      ) : (
                        <select
                          id="to-schedule"
                          className="form-input"
                          value={toId}
                          onChange={e => setToId(e.target.value)}
                          required
                        >
                          <option value="">-- Pilih jadwal tujuan --</option>
                          {filteredSlot.map(s => (
                            <option key={s.id} value={s.id}>
                              {formatShiftLabel(s.dayOfWeek, s.slotStart, s.slotEnd)} — {s.employeeName}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Alasan */}
                    <div>
                      <label className="form-label" htmlFor="reason">
                        Alasan pengajuan * <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(min. 10 karakter)</span>
                      </label>
                      <textarea
                        id="reason"
                        className="form-input"
                        rows={3}
                        placeholder="Contoh: Ada kegiatan keluarga pada hari tersebut..."
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        required
                        minLength={10}
                        maxLength={500}
                        style={{ resize: 'vertical' }}
                      />
                      <p style={{ fontSize: 'var(--text-xs)', color: reason.length < 10 ? 'var(--color-text-muted)' : 'hsl(142 55% 35%)', marginTop: 4 }}>
                        {reason.length}/500 karakter
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={submitting || !fromId || !toId || reason.trim().length < 10}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                      {submitting
                        ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Mengirim...</>
                        : <><Send size={15} /> Kirim Pengajuan</>}
                    </button>
                  </form>
                </div>
              </section>
            ) : null}

            {/* Riwayat pengajuan */}
            <section className="card">
              <div className="card-body" style={{ padding: '16px 20px' }}>
                <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', marginBottom: 14 }}>
                  Riwayat Pengajuan Kamu
                </h2>

                {history.length === 0 ? (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: '20px 0' }}>
                    Belum ada pengajuan.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {history.map(req => {
                      const s = STATUS_STYLE[req.status] ?? STATUS_STYLE.PENDING!;
                      return (
                        <div key={req.id} style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px 14px',
                          background: 'var(--color-surface)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                              {new Date(req.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                            <span style={{
                              background: s.bg, color: s.color,
                              padding: '2px 10px', borderRadius: '999px',
                              fontSize: '0.7rem', fontWeight: 700,
                              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                            }}>
                              {req.status === 'APPROVED' ? <CheckCircle size={11} /> : req.status === 'REJECTED' ? <XCircle size={11} /> : null}
                              {s.label}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                            <span style={{ fontSize: 'var(--text-xs)', background: 'hsl(0 0% 50% / 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                              {formatShiftLabel(req.fromSchedule.dayOfWeek, req.fromSchedule.slotStart, req.fromSchedule.slotEnd)}
                            </span>
                            <ArrowLeftRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                            <span style={{ fontSize: 'var(--text-xs)', background: 'hsl(142 60% 45% / 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                              {formatShiftLabel(req.toSchedule.dayOfWeek, req.toSchedule.slotStart, req.toSchedule.slotEnd)}
                            </span>
                          </div>
                          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
                            &ldquo;{req.reason}&rdquo;
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
