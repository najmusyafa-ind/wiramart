'use client';
// =============================================================
// DashboardWidgets — Client component untuk realtime widgets:
// 1. Widget Jadwal Hari Ini (siapa on-duty sekarang)
// 2. Live Cash vs QRIS counter (polling 30 detik)
// =============================================================

import { useState, useEffect, useCallback } from 'react';
import { Users, Clock, Banknote, Wifi } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type KaryawanEntry = {
  id: string | null;
  nama: string | null;
  nim: string | null;
  prodi: string | null;
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

type LiveMoneyData = {
  cashTotal: number;
  qrisTotal: number;
  totalTransactions: number;
  lastUpdated: string;
};

// ─────────────────────────────────────────────────────────────
// Widget 1: Jadwal Hari Ini
// ─────────────────────────────────────────────────────────────
function JadwalWidget() {
  const [data, setData] = useState<JadwalData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchJadwal = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/jadwal-hari-ini');
      const json = await res.json() as { success: boolean; data?: JadwalData };
      if (json.success && json.data) setData(json.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchJadwal();
    // Refresh setiap 5 menit (jadwal tidak berubah menit-menit)
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
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Tidak ada jadwal untuk hari ini ({data?.dayOfWeek ?? '—'}).
        </div>
      </div>
    );
  }

  // Slot yang sedang aktif sekarang
  const activeSlots = data.slots.filter(s => s.isCurrentSlot);
  const otherSlots  = data.slots.filter(s => !s.isCurrentSlot);
  const coordinator = data.slots.find(s => s.coordinator)?.coordinator;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Users size={15} aria-hidden="true" />
          Jadwal Hari Ini — {data.dayOfWeek}
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Clock size={11} /> {data.timeNow} WIB
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Koordinator */}
        {coordinator && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>Koordinator:</span>
            <span style={{ color: 'var(--color-primary)' }}>{coordinator}</span>
          </div>
        )}

        {/* Slot aktif sekarang */}
        {activeSlots.map((slot) => (
          <div key={`${slot.slotStart}-${slot.slotEnd}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                gap: 'var(--space-1)', padding: '2px var(--space-2)',
                background: 'var(--color-success)', color: 'white',
                borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />
                ON DUTY
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {slot.slotStart} – {slot.slotEnd}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {slot.karyawan.map((k, i) => (
                <div key={k.id ?? i} style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-success-light)',
                  border: '1px solid var(--color-success)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                }}>
                  <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-success)' }}>
                    {k.nama ?? '—'}
                  </div>
                  {k.nim && <div style={{ color: 'var(--color-text-muted)' }}>{k.nim}</div>}
                </div>
              ))}
              {slot.karyawan.length === 0 && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Belum ada karyawan terjadwal</span>
              )}
            </div>
          </div>
        ))}

        {/* Slot lainnya */}
        {otherSlots.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-semibold)' }}>
              Shift Lainnya
            </div>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Widget 2: Live Cash vs QRIS (polling 30 detik)
// ─────────────────────────────────────────────────────────────
function LiveMoneyWidget() {
  const [data, setData] = useState<LiveMoneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastTick, setLastTick] = useState('');

  const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/laporan?period=daily');
      const json = await res.json() as {
        success: boolean;
        data?: {
          summary?: {
            amountCash?: number;
            amountQris?: number;
            totalCount?: number;
          };
        };
      };
      if (json.success && json.data?.summary) {
        const s = json.data.summary;
        setData({
          cashTotal: s.amountCash ?? 0,
          qrisTotal: s.amountQris ?? 0,
          totalTransactions: s.totalCount ?? 0,
          lastUpdated: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
        setLastTick(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLive();
    // Polling setiap 30 detik
    const id = setInterval(fetchLive, 30 * 1000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const cashPct = data && (data.cashTotal + data.qrisTotal) > 0
    ? Math.round((data.cashTotal / (data.cashTotal + data.qrisTotal)) * 100)
    : 0;
  const qrisPct = 100 - cashPct;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Banknote size={15} aria-hidden="true" />
          Cash vs QRIS — Hari Ini
        </h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>
          <Wifi size={11} aria-hidden="true" />
          {lastTick || 'Memuat...'}
        </span>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Memuat data...</div>
        ) : !data ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Gagal memuat data.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Progress bar */}
            <div>
              <div style={{ display: 'flex', borderRadius: 'var(--radius-full)', overflow: 'hidden', height: 10 }}>
                <div style={{ width: `${cashPct}%`, background: 'var(--color-success)', transition: 'width 0.8s ease' }} />
                <div style={{ width: `${qrisPct}%`, background: 'var(--color-info)', transition: 'width 0.8s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                <span>Tunai {cashPct}%</span>
                <span>QRIS {qrisPct}%</span>
              </div>
            </div>

            {/* Detail */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 'var(--weight-semibold)', marginBottom: 2 }}>
                  Tunai
                </div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>
                  {rp(data.cashTotal)}
                </div>
              </div>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-info-light)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info)', fontWeight: 'var(--weight-semibold)', marginBottom: 2 }}>
                  QRIS
                </div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: 'var(--color-info)' }}>
                  {rp(data.qrisTotal)}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Total {data.totalTransactions} transaksi hari ini · Auto-refresh 30 detik
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Export: container kedua widget
// ─────────────────────────────────────────────────────────────
export default function DashboardWidgets() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
      <JadwalWidget />
      <LiveMoneyWidget />
    </div>
  );
}
