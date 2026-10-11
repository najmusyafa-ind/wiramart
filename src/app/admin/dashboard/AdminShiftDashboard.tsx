'use client';
// ================================================================
// AdminShiftDashboard — Dashboard Operasional untuk ADMIN_SHIFT
// Fokus: Shift aktif, jadwal hari ini, absensi, stok kritis, kas gerak
// TIDAK menampilkan: Laba, Omzet, QRIS rekonsiliasi, Approval Dosen
// ================================================================

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Clock,
  Users,
  CalendarDays,
  Package,
  ArrowLeftRight,
  Coins,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  ScanLine,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type KaryawanEntry = {
  id: string | null;
  nama: string | null;
  nim: string | null;
  onDuty: boolean;
};

type SlotEntry = {
  slotStart: string;
  slotEnd: string;
  isCurrentSlot: boolean;
  coordinator: string | null;
  karyawan: KaryawanEntry[];
};

type JadwalData = {
  dayOfWeek: string;
  timeNow: string;
  tanggal: string;
  slots: SlotEntry[];
};

type ShiftSummary = {
  activeShifts: number;
  totalEmployees: number;
  pendingSwaps: number;
  criticalBatches: number;
  pettyCashOut: number;
  pettyCashIn: number;
  todayTransactions: number;
};

const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// ─────────────────────────────────────────────────────────────
// Stat Card Mini
// ─────────────────────────────────────────────────────────────
function MiniStatCard({
  icon,
  label,
  value,
  sub,
  accentColor,
  alertLevel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accentColor: string;
  alertLevel?: 'ok' | 'warn' | 'danger';
}) {
  const borderColor =
    alertLevel === 'danger'
      ? 'var(--color-error)'
      : alertLevel === 'warn'
      ? 'hsl(38 92% 50%)'
      : 'var(--color-border)';
  const bgColor =
    alertLevel === 'danger'
      ? 'hsl(0 84% 60% / 0.06)'
      : alertLevel === 'warn'
      ? 'hsl(38 92% 50% / 0.06)'
      : 'var(--color-surface)';

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 3,
          background: accentColor,
          borderRadius: 'var(--radius-full) var(--radius-full) 0 0',
        }}
      />
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34, height: 34,
          borderRadius: 'var(--radius-md)',
          background: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
          color: accentColor,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--space-1)', marginTop: 'auto' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Widget Jadwal Hari Ini
// ─────────────────────────────────────────────────────────────
function JadwalShiftWidget() {
  const [data, setData] = useState<JadwalData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchJadwal = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/jadwal-hari-ini');
      const json = await res.json() as { success: boolean; data?: JadwalData };
      if (json.success && json.data) setData(json.data);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchJadwal();
    const id = setInterval(fetchJadwal, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchJadwal]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          <Clock size={14} /> Memuat jadwal...
        </div>
      </div>
    );
  }

  if (!data || data.slots.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <CalendarDays size={32} aria-hidden="true" style={{ margin: '0 auto var(--space-2)', opacity: 0.3 }} />
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
          Tidak ada jadwal shift untuk hari ini ({data?.dayOfWeek ?? '—'}).
        </p>
        <Link href="/admin/jadwal" className="btn btn-ghost btn-sm">
          Kelola Jadwal
        </Link>
      </div>
    );
  }

  const activeSlots = data.slots.filter(s => s.isCurrentSlot);
  const otherSlots = data.slots.filter(s => !s.isCurrentSlot);
  const coordinator = data.slots.find(s => s.coordinator)?.coordinator;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <CalendarDays size={15} aria-hidden="true" />
          Jadwal Shift — {data.dayOfWeek}
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Clock size={11} /> {data.timeNow} WIB
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {coordinator && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)' }}>
            <ShieldCheck size={13} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Koordinator:</span>
            <span style={{ color: 'var(--color-primary)' }}>{coordinator}</span>
          </div>
        )}

        {activeSlots.length > 0 ? activeSlots.map((slot) => (
          <div key={`${slot.slotStart}-${slot.slotEnd}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', padding: '2px var(--space-2)', background: 'var(--color-success)', color: 'white', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />
                ON DUTY
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {slot.slotStart} – {slot.slotEnd}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {slot.karyawan.map((k, i) => (
                <div key={k.id ?? i} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-success-light)', border: '1px solid var(--color-success)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-success)' }}>{k.nama ?? '—'}</div>
                  {k.nim && <div style={{ color: 'var(--color-text-muted)' }}>{k.nim}</div>}
                </div>
              ))}
              {slot.karyawan.length === 0 && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Belum ada karyawan terjadwal</span>
              )}
            </div>
          </div>
        )) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Clock size={14} style={{ opacity: 0.5 }} /> Tidak ada slot aktif saat ini.
          </div>
        )}

        {otherSlots.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Shift Lainnya</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {otherSlots.map((slot) => (
                <div key={`${slot.slotStart}-${slot.slotEnd}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', minWidth: 90 }}>{slot.slotStart}–{slot.slotEnd}</span>
                  <span>{slot.karyawan.map(k => k.nama ?? '—').join(', ') || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
        <Link href="/admin/jadwal" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>
          Kelola Jadwal Lengkap <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Widget Kas Gerak Hari Ini
// ─────────────────────────────────────────────────────────────
function KasGerakWidget({ cashOut, cashIn }: { cashOut: number; cashIn: number }) {
  const netKas = cashIn - cashOut;
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Coins size={15} aria-hidden="true" /> Kas Gerak Laci Hari Ini
        </h2>
        <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>Petty Cash</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div style={{ padding: 'var(--space-3)', background: 'hsl(0 84% 60% / 0.08)', border: '1px solid hsl(0 84% 60% / 0.25)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', fontWeight: 700, marginBottom: 4 }}>Kas Keluar</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-error)' }}>{rp(cashOut)}</div>
          </div>
          <div style={{ padding: 'var(--space-3)', background: 'hsl(142 71% 45% / 0.08)', border: '1px solid hsl(142 71% 45% / 0.25)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 700, marginBottom: 4 }}>Kas Masuk</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-success)' }}>{rp(cashIn)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface-elevated, var(--color-surface))', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', border: '1px solid var(--color-border)' }}>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Selisih Bersih</span>
          <span style={{ fontWeight: 800, color: netKas >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
            {netKas >= 0 ? '+' : ''}{rp(netKas)}
          </span>
        </div>
        <p style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', margin: 0 }}>
          Pengeluaran darurat (galon, bensin, kresek) dicatat kasir via tombol Kas Gerak di POS.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Export — Admin Shift Dashboard
// ─────────────────────────────────────────────────────────────
export default function AdminShiftDashboard({
  adminName,
  todayLabel,
  summary,
}: {
  adminName: string;
  todayLabel: string;
  summary: ShiftSummary;
}) {
  const [lastRefresh, setLastRefresh] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setLastRefresh(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    window.location.reload();
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Dashboard Admin Shift
            </h1>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: '0.75rem', fontWeight: 700,
                background: 'rgba(37, 99, 235, 0.12)',
                color: '#2563eb',
                border: '1px solid rgba(37, 99, 235, 0.25)',
                borderRadius: 999,
                padding: '3px 10px',
              }}
            >
              🛡️ Operasional Shift
            </span>
          </div>
          <p className="page-subtitle" style={{ marginTop: 'var(--space-1)' }}>
            Selamat bertugas, <strong>{adminName}</strong> · Jadwal, absensi, stok, dan kas gerak kasir · {todayLabel}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link href="/admin/absensi" className="btn btn-secondary btn-sm">
            <ClipboardList size={14} aria-hidden="true" />
            Absensi
          </Link>
          <Link href="/admin/jadwal" className="btn btn-primary btn-sm">
            <CalendarDays size={14} aria-hidden="true" />
            Jadwal
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data"
            aria-label="Refresh data halaman"
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 8px', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={14} aria-hidden="true" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* ── Banner Info Peran ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, hsl(220 90% 56% / 0.1) 0%, hsl(220 90% 56% / 0.04) 100%)',
          border: '1px solid hsl(220 90% 56% / 0.25)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 'var(--radius-full)', background: 'hsl(220 90% 56%)', flexShrink: 0 }}>
          <ShieldCheck size={20} color="white" aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'hsl(220 90% 40%)' }}>
            Anda Login sebagai Admin Shift (Koordinator Operasional)
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.5 }}>
            Akses terbatas pada: Produk, Restock, Karyawan, Jadwal, Absensi, dan Tukar Shift.
            Data finansial &amp; laporan laba hanya dapat dilihat oleh Manajer / Dosen Pembina.
          </div>
        </div>
        {lastRefresh && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>
            Update: {lastRefresh}
          </div>
        )}
      </div>

      {/* ── Grid KPI Operasional ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
        role="region"
        aria-label="Statistik operasional hari ini"
      >
        <MiniStatCard
          icon={<Users size={18} />}
          label="Kasir On-Duty"
          value={`${summary.activeShifts} / ${summary.totalEmployees}`}
          sub="Karyawan aktif terdaftar"
          accentColor="var(--color-success)"
          alertLevel={summary.activeShifts === 0 ? 'warn' : 'ok'}
        />
        <MiniStatCard
          icon={<TrendingUp size={18} />}
          label="Transaksi Hari Ini"
          value={`${summary.todayTransactions} Trx`}
          sub="Dari semua kasir"
          accentColor="var(--color-primary)"
        />
        <MiniStatCard
          icon={<ArrowLeftRight size={18} />}
          label="Tukar Shift Pending"
          value={summary.pendingSwaps > 0 ? `${summary.pendingSwaps} Menunggu` : 'Nihil'}
          sub={summary.pendingSwaps > 0 ? 'Butuh persetujuan Dosen' : 'Tidak ada pengajuan'}
          accentColor="hsl(38 92% 48%)"
          alertLevel={summary.pendingSwaps > 0 ? 'warn' : 'ok'}
        />
        <MiniStatCard
          icon={<Package size={18} />}
          label="Stok Kritis (FEFO)"
          value={summary.criticalBatches > 0 ? `${summary.criticalBatches} Batch` : 'Aman'}
          sub={summary.criticalBatches > 0 ? 'Segera periksa gudang' : 'Semua batch masih aman'}
          accentColor="var(--color-error)"
          alertLevel={summary.criticalBatches > 0 ? 'danger' : 'ok'}
        />
        <MiniStatCard
          icon={<Coins size={18} />}
          label="Kas Keluar Hari Ini"
          value={rp(summary.pettyCashOut)}
          sub={`Masuk: ${rp(summary.pettyCashIn)}`}
          accentColor="hsl(270 80% 55%)"
        />
      </div>

      {/* ── Zona Aksi Cepat ── */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            background: 'hsl(220 90% 56% / 0.07)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius-full)', background: 'hsl(220 90% 56%)', color: 'white', flexShrink: 0 }}>
            <CheckCircle2 size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0 }}>Aksi Cepat Admin Shift</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>Navigasi langsung ke tugas operasional Anda.</p>
          </div>
        </div>

        <div style={{ padding: 'var(--space-5)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-4)' }}>

          {/* 1. Produk & Restock */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: `1px solid ${summary.criticalBatches > 0 ? 'var(--color-error)' : 'var(--color-border)'}`, background: summary.criticalBatches > 0 ? 'hsl(0 84% 60% / 0.04)' : 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.88rem', color: summary.criticalBatches > 0 ? 'var(--color-error)' : 'inherit' }}>
                <Package size={18} style={{ color: summary.criticalBatches > 0 ? 'var(--color-error)' : 'var(--color-primary)' }} />
                Produk & Restock
              </div>
              {summary.criticalBatches > 0 && (
                <span className="badge badge-error" style={{ fontSize: '0.7rem' }}>{summary.criticalBatches} Kritis</span>
              )}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              Kelola katalog produk, cek stok, input restock barcode, dan pantau batch kedaluwarsa FEFO.
            </p>
            {summary.criticalBatches > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-error)', fontWeight: 600 }}>
                <AlertTriangle size={12} aria-hidden="true" /> {summary.criticalBatches} batch stok mendekati atau melewati kedaluwarsa!
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'auto', flexWrap: 'wrap' }}>
              <Link href="/admin/produk" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>
                Daftar Produk <ChevronRight size={14} />
              </Link>
              <Link href="/admin/restock" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                <ScanLine size={13} aria-hidden="true" /> Restock Barcode
              </Link>
            </div>
          </div>

          {/* 2. Absensi */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.88rem' }}>
              <ClipboardList size={18} style={{ color: 'hsl(38 92% 40%)' }} />
              Rekap Absensi
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              Pantau kehadiran, keterlambatan, dan ketidakhadiran mahasiswa kasir berdasarkan jadwal shift.
            </p>
            <Link href="/admin/absensi" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 'auto' }}>
              Buka Rekap Absensi <ChevronRight size={14} />
            </Link>
          </div>

          {/* 3. Tukar Shift */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: `1px solid ${summary.pendingSwaps > 0 ? 'hsl(38 92% 50% / 0.4)' : 'var(--color-border)'}`, background: summary.pendingSwaps > 0 ? 'hsl(38 92% 50% / 0.05)' : 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.88rem', color: summary.pendingSwaps > 0 ? 'hsl(38 92% 38%)' : 'inherit' }}>
                <ArrowLeftRight size={18} style={{ color: summary.pendingSwaps > 0 ? 'hsl(38 92% 45%)' : 'var(--color-text-muted)' }} />
                Pengajuan Tukar Shift
              </div>
              {summary.pendingSwaps > 0 && (
                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>{summary.pendingSwaps} Menunggu</span>
              )}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              {summary.pendingSwaps > 0
                ? 'Ada permintaan tukar shift yang menunggu verifikasi dari Dosen Pembina. Lihat riwayat dan teruskan.'
                : 'Tidak ada permintaan tukar shift yang aktif saat ini.'}
            </p>
            <Link href="/admin/swap-request" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 'auto' }}>
              Riwayat Tukar Shift <ChevronRight size={14} />
            </Link>
          </div>

          {/* 4. Data Karyawan */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.88rem' }}>
              <Users size={18} style={{ color: 'var(--color-info)' }} />
              Data Karyawan
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              Lihat profil, NIM, dan program studi seluruh mahasiswa kasir yang terdaftar aktif.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-info-light)', borderRadius: 'var(--radius-md)' }}>
              <Users size={13} aria-hidden="true" style={{ color: 'var(--color-info)', flexShrink: 0 }} />
              <span style={{ color: 'var(--color-info)', fontWeight: 600 }}>{summary.totalEmployees} karyawan aktif terdaftar</span>
            </div>
            <Link href="/admin/karyawan" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none', marginTop: 'auto' }}>
              Lihat Daftar Karyawan <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Row: Jadwal Hari Ini + Kas Gerak ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 'var(--space-5)' }}>
        <JadwalShiftWidget />
        <KasGerakWidget cashOut={summary.pettyCashOut} cashIn={summary.pettyCashIn} />
      </div>
    </div>
  );
}
