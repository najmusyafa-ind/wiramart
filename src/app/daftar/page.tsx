'use client';
// =============================================================
// /daftar — Halaman Self-Service: Aktivasi Dosen + Daftar Mahasiswa
// =============================================================

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  GraduationCap, Users, KeyRound, Search, CheckCircle,
  AlertCircle, Loader2, ArrowLeft, ChevronRight,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Mode = 'choose' | 'dosen' | 'mahasiswa';
type DosenTab = 'aktivasi' | 'lupa';
type MahasiswaTab = 'daftar' | 'lupa-nim';

type SlotEntry = {
  id: string;
  orderInSlot: number;
  employeeId: string | null;
  employeeName: string | null;
  isFilled: boolean;
};
type SlotGroup = {
  slotStart: string;
  slotEnd: string;
  coordinatorName: string | null;
  entries: SlotEntry[];
  filledCount: number;
  totalCount: number;
};
type DayGroup = { dayOfWeek: string; slots: SlotGroup[] };

// ─────────────────────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────────────────────
function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 'var(--space-5)' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 8, height: 8,
          borderRadius: 'var(--radius-full)',
          background: i === current ? 'var(--color-primary)' : 'var(--color-border)',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shift Grid untuk pilih slot
// ─────────────────────────────────────────────────────────────
function ShiftGrid({ onSelect, selected }: {
  onSelect: (slotId: string) => void;
  selected: string | null;
}) {
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/publik/jadwal-slot')
      .then(r => r.json())
      .then((j: { success: boolean; data?: { schedule: DayGroup[] } }) => {
        if (j.success && j.data) setSchedule(j.data.schedule);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}><Loader2 size={20} className="spin-icon" style={{ display: 'inline' }} /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {schedule.map((day) => (
        <div key={day.dayOfWeek}>
          <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', padding: 'var(--space-1) var(--space-3)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)' }}>
            {day.dayOfWeek}
          </div>
          {day.slots.map((slot) => (
            <div key={`${slot.slotStart}-${slot.slotEnd}`} style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)', marginLeft: 'var(--space-1)' }}>
                {slot.slotStart} – {slot.slotEnd}
                {slot.coordinatorName && <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>Koordinator: {slot.coordinatorName}</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {slot.entries.map((entry) =>
                  entry.isFilled ? (
                    // Slot terisi
                    <div key={entry.id} style={{
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--color-surface-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      display: 'flex', alignItems: 'center', gap: 4,
                      cursor: 'not-allowed', opacity: 0.7,
                    }}>
                      <CheckCircle size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                      {entry.employeeName}
                    </div>
                  ) : (
                    // Slot kosong — bisa diklik
                    <button
                      key={entry.id}
                      onClick={() => onSelect(entry.id)}
                      style={{
                        padding: 'var(--space-2) var(--space-4)',
                        border: selected === entry.id
                          ? '2px solid var(--color-primary)'
                          : '1.5px dashed var(--color-border)',
                        background: selected === entry.id
                          ? 'var(--color-primary-light)'
                          : 'transparent',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-xs)',
                        color: selected === entry.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        cursor: 'pointer',
                        fontWeight: selected === entry.id ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                        transition: 'all 0.2s ease',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      {selected === entry.id ? (
                        <><CheckCircle size={11} /> Dipilih</>
                      ) : (
                        <>Kosong {entry.orderInSlot}</>
                      )}
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PANEL: Dosen — Aktivasi / Lupa Password
// ─────────────────────────────────────────────────────────────
function PanelDosen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<DosenTab>('aktivasi');
  const [nidn, setNidn] = useState('');
  const [namaLengkap, setNamaLengkap] = useState('');
  const [password, setPassword] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const router = useRouter();

  async function handleSubmit() {
    if (!nidn || !namaLengkap || !password || !konfirmasi) return;
    if (password !== konfirmasi) {
      setResult({ ok: false, msg: 'Konfirmasi password tidak cocok.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/auth/admin/aktivasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nidn, fullName: namaLengkap, password, confirmPassword: konfirmasi }),
      });
      const json = await res.json() as { success: boolean; data?: { message: string; isFirstTime?: boolean }; error?: string };
      if (json.success) {
        setResult({ ok: true, msg: json.data?.message ?? 'Berhasil!' });
        setTimeout(() => router.push('/login'), 2000);
      } else {
        setResult({ ok: false, msg: json.error ?? 'Gagal. Coba lagi.' });
      }
    } catch {
      setResult({ ok: false, msg: 'Kesalahan jaringan.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={14} /> Kembali
      </button>

      <div style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-5)', borderBottom: '2px solid var(--color-border)' }}>
        {(['aktivasi', 'lupa'] as DosenTab[]).map((t) => (
          <button key={t} onClick={() => { setTab(t); setResult(null); }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)', fontWeight: tab === t ? 'var(--weight-bold)' : 'var(--weight-normal)',
            color: tab === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: -2,
          }}>
            {t === 'aktivasi' ? '✨ Aktivasi Akun' : '🔑 Lupa Password'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="form-group">
          <label className="form-label">NIDN / NIDK</label>
          <input className="form-input" placeholder="Contoh: 0412345678" value={nidn} onChange={e => setNidn(e.target.value)} />
          <p className="form-hint">Nomor Induk Dosen Nasional atau Nomor Induk Dosen Khusus.</p>
        </div>
        <div className="form-group">
          <label className="form-label">Nama Lengkap</label>
          <input className="form-input" placeholder="Nama sesuai dokumen resmi" value={namaLengkap} onChange={e => setNamaLengkap(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{tab === 'aktivasi' ? 'Buat Password Baru' : 'Password Baru'}</label>
          <input className="form-input" type="password" placeholder="Minimal 6 karakter" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Konfirmasi Password</label>
          <input className="form-input" type="password" placeholder="Ulangi password baru" value={konfirmasi} onChange={e => setKonfirmasi(e.target.value)} />
        </div>

        {result && (
          <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: result.ok ? 'var(--color-success-light)' : 'var(--color-error-light)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--text-sm)' }}>
            {result.ok ? <CheckCircle size={16} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 1 }} />}
            <span style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.msg}</span>
          </div>
        )}

        <button onClick={handleSubmit} className="btn btn-primary" disabled={loading || !nidn || !namaLengkap || !password || !konfirmasi} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <><Loader2 size={16} className="spin-icon" /> Memproses...</> : (tab === 'aktivasi' ? '✅ Aktivasi Akun' : '🔑 Reset Password')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PANEL: Mahasiswa — Daftar + Pilih Shift / Lupa NIM
// ─────────────────────────────────────────────────────────────
function PanelMahasiswa({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<MahasiswaTab>('daftar');
  // Step daftar: 1 = isi data, 2 = pilih slot, 3 = sukses
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [nama, setNama] = useState('');
  const [nim, setNim] = useState('');
  const [prodi, setProdi] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  // Lupa NIM
  const [lupaName, setLupaName] = useState('');
  const [lupaProdi, setLupaProdi] = useState('');
  const [nimResult, setNimResult] = useState<{ nim: string; nimMasked: string; fullName: string } | null>(null);
  const [lupaLoading, setLupaLoading] = useState(false);
  const [lupaError, setLupaError] = useState<string | null>(null);

  async function handleDaftar() {
    if (!selectedSlot) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/karyawan/daftar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: nama, nim, programStudi: prodi, slotId: selectedSlot }),
      });
      const json = await res.json() as { success: boolean; data?: { message: string }; error?: string };
      if (json.success) {
        setSuccessMsg(json.data?.message ?? 'Pendaftaran berhasil!');
        setStep(3);
      } else {
        setError(json.error ?? 'Gagal mendaftar.');
      }
    } catch {
      setError('Kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCariNim() {
    setLupaLoading(true);
    setLupaError(null);
    setNimResult(null);
    try {
      const res = await fetch('/api/publik/cari-nim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: lupaName, programStudi: lupaProdi }),
      });
      const json = await res.json() as { success: boolean; data?: { nim: string; nimMasked: string; fullName: string }; error?: string };
      if (json.success && json.data) setNimResult(json.data);
      else setLupaError(json.error ?? 'Data tidak ditemukan.');
    } catch {
      setLupaError('Kesalahan jaringan.');
    } finally {
      setLupaLoading(false);
    }
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={14} /> Kembali
      </button>

      {/* Tab */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-5)', borderBottom: '2px solid var(--color-border)' }}>
        {([['daftar', '📝 Daftar Shift'], ['lupa-nim', '🔍 Lupa NIM']] as [MahasiswaTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t as MahasiswaTab); setError(null); }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)', fontWeight: tab === t ? 'var(--weight-bold)' : 'var(--weight-normal)',
            color: tab === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent', marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {/* ── Tab: Daftar ── */}
      {tab === 'daftar' && (
        <div>
          {step < 3 && <StepDots total={2} current={step - 1} />}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label">Nama Lengkap</label>
                <input className="form-input" placeholder="Sesuai data pendaftaran" value={nama} onChange={e => setNama(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">NIM</label>
                <input className="form-input" placeholder="Nomor Induk Mahasiswa" value={nim} onChange={e => setNim(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Program Studi</label>
                <input className="form-input" placeholder="Contoh: Teknik Informatika" value={prodi} onChange={e => setProdi(e.target.value)} />
              </div>
              <button
                onClick={() => { setError(null); setStep(2); }}
                className="btn btn-primary"
                disabled={!nama || !nim || !prodi}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                Lanjut Pilih Shift <ChevronRight size={16} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
                <strong>{nama}</strong> · NIM {nim} · {prodi}
                <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 'var(--text-xs)', marginLeft: 8 }}>ubah</button>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Pilih slot jadwal yang <strong>kosong</strong>:
              </p>
              <ShiftGrid onSelect={setSelectedSlot} selected={selectedSlot} />
              {error && (
                <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', display: 'flex', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: 1 }}>Kembali</button>
                <button
                  onClick={handleDaftar}
                  className="btn btn-primary"
                  disabled={!selectedSlot || loading}
                  style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {loading ? <><Loader2 size={16} className="spin-icon" /> Mendaftar...</> : '✅ Daftar Sekarang'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--color-success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'check-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                <CheckCircle size={36} style={{ color: 'var(--color-success)' }} />
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', textAlign: 'center' }}>{successMsg}</p>
              <a href="/login" className="btn btn-primary">Login Sekarang →</a>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Lupa NIM ── */}
      {tab === 'lupa-nim' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Masukkan nama lengkap dan program studi, sistem akan mencari NIM kamu.
          </p>
          <div className="form-group">
            <label className="form-label">Nama Lengkap</label>
            <input className="form-input" placeholder="Sesuai data pendaftaran" value={lupaName} onChange={e => setLupaName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Program Studi</label>
            <input className="form-input" placeholder="Contoh: Teknik Informatika" value={lupaProdi} onChange={e => setLupaProdi(e.target.value)} />
          </div>
          {lupaError && (
            <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', display: 'flex', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} /> {lupaError}
            </div>
          )}
          {nimResult && (
            <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-success-light)', border: '1px solid var(--color-success)' }}>
              <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', marginBottom: 4 }}>NIM Ditemukan!</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>{nimResult.nim}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>{nimResult.fullName}</div>
            </div>
          )}
          <button
            onClick={handleCariNim}
            className="btn btn-primary"
            disabled={lupaLoading || !lupaName || !lupaProdi}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {lupaLoading ? <><Loader2 size={16} className="spin-icon" /> Mencari...</> : <><Search size={16} /> Cari NIM</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function DaftarPage() {
  const [mode, setMode] = useState<Mode>('choose');

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', padding: 'var(--space-5)',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div style={{ width: 64, height: 64, position: 'relative', margin: '0 auto var(--space-2)' }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
            Wiramart UNPERBA
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            {mode === 'choose' ? 'Aktivasi akun atau daftar shift' : mode === 'dosen' ? 'Portal Dosen / Admin' : 'Portal Mahasiswa Kasir'}
          </p>
        </div>

        <div className="card">
          <div className="card-body">
            {mode === 'choose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: 'var(--space-2)' }}>
                  Pilih peran kamu:
                </p>
                <button
                  onClick={() => setMode('dosen')}
                  style={{
                    padding: 'var(--space-5)', border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                    transition: 'all 0.2s ease', textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <GraduationCap size={22} style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', marginBottom: 2 }}>Dosen / Admin</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Aktivasi akun atau reset password dengan NIDN/NIDK</div>
                  </div>
                  <ChevronRight size={18} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }} />
                </button>

                <button
                  onClick={() => setMode('mahasiswa')}
                  style={{
                    padding: 'var(--space-5)', border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                    transition: 'all 0.2s ease', textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-info-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Users size={22} style={{ color: 'var(--color-info)' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', marginBottom: 2 }}>Mahasiswa / Karyawan</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Daftar shift atau cari NIM yang terlupakan</div>
                  </div>
                  <ChevronRight size={18} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }} />
                </button>

                <div style={{ textAlign: 'center', paddingTop: 'var(--space-2)' }}>
                  <a href="/login" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Sudah punya akun? <span style={{ color: 'var(--color-primary)' }}>Login di sini</span>
                  </a>
                </div>
              </div>
            )}

            {mode === 'dosen' && <PanelDosen onBack={() => setMode('choose')} />}
            {mode === 'mahasiswa' && <PanelMahasiswa onBack={() => setMode('choose')} />}
          </div>
        </div>
      </div>
    </div>
  );
}
