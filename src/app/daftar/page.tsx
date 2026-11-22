'use client';
// =============================================================
// /daftar — Halaman Self-Service: Aktivasi Dosen + Daftar Mahasiswa
// =============================================================

import { useState, useEffect, useId } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  GraduationCap, Users, Search, CheckCircle,
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
          transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shift Grid untuk pilih slot (dengan In-Memory Cache & Prefetch)
// ─────────────────────────────────────────────────────────────
let scheduleSlotsMemCache: DayGroup[] = [];

function ShiftGrid({ onSelect, selected }: {
  onSelect: (slotId: string) => void;
  selected: string | null;
}) {
  const [schedule, setSchedule] = useState<DayGroup[]>(() => scheduleSlotsMemCache);
  const [loading, setLoading] = useState<boolean>(() => scheduleSlotsMemCache.length === 0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/publik/jadwal-slot', { signal: controller.signal })
      .then(r => r.json())
      .then((j: { success: boolean; data?: { schedule: DayGroup[] } }) => {
        if (!controller.signal.aborted && j.success && j.data) {
          scheduleSlotsMemCache = j.data.schedule;
          setSchedule(j.data.schedule);
        }
      })
      .catch(() => {
        // silent
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}><Loader2 size={20} className="spin-icon" style={{ display: 'inline' }} /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {schedule.map((day) => (
        <div key={day.dayOfWeek}>
          <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)', marginBottom: 'var(--space-2)', padding: 'var(--space-1) var(--space-3)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)' }}>
            {day.dayOfWeek}
          </div>
          {day.slots.map((slot) => {
            const normalEntries = slot.entries.filter(e => e.orderInSlot !== 99);
            const emptyCount = normalEntries.filter(e => !e.isFilled).length;
            const totalNormal = normalEntries.length;
            const isFull = emptyCount === 0;
            return (
              <div key={`${slot.slotStart}-${slot.slotEnd}`} style={{ marginBottom: 'var(--space-3)' }}>
                {/* Slot header dengan badge kapasitas */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)', marginLeft: 'var(--space-1)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {slot.slotStart} – {slot.slotEnd}
                    {slot.coordinatorName && <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>Koordinator: {slot.coordinatorName}</span>}
                  </div>
                  {/* Badge sisa slot */}
                  <div style={{
                    fontSize: '10px',
                    fontWeight: 'var(--weight-bold)',
                    padding: '1px 8px',
                    borderRadius: 999,
                    background: isFull ? 'hsl(0,72%,95%)' : emptyCount <= 1 ? 'hsl(38,92%,92%)' : 'hsl(145,55%,92%)',
                    color: isFull ? 'hsl(0,72%,40%)' : emptyCount <= 1 ? 'hsl(38,92%,32%)' : 'hsl(145,55%,28%)',
                  }}>
                    {isFull ? 'Penuh' : `${emptyCount} tersisa`}
                  </div>
                </div>
                {/* Mini progress bar */}
                {totalNormal > 0 && (
                  <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 999, marginBottom: 'var(--space-2)', marginLeft: 'var(--space-1)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.round(((totalNormal - emptyCount) / totalNormal) * 100)}%`,
                      background: isFull ? 'hsl(0,72%,50%)' : emptyCount <= 1 ? 'hsl(38,92%,50%)' : 'var(--color-success)',
                      borderRadius: 999,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                )}
                {/* Slot buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {normalEntries.map((entry) =>
                    entry.isFilled ? (
                      <div key={entry.id} style={{
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'var(--color-surface-muted)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        display: 'flex', alignItems: 'center', gap: 4,
                        cursor: 'not-allowed', opacity: 0.6,
                      }}>
                        <CheckCircle size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                        {entry.employeeName}
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={selected === entry.id}
                        key={entry.id}
                        onClick={() => onSelect(entry.id)}
                        style={{
                          padding: '8px var(--space-4)',
                          minHeight: 44,
                          border: selected === entry.id
                            ? '2px solid var(--color-primary)'
                            : '1.5px dashed hsl(145,55%,50%)',
                          background: selected === entry.id
                            ? 'var(--color-primary-light)'
                            : 'hsl(145,55%,97%)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: 'var(--text-xs)',
                          color: selected === entry.id ? 'var(--color-primary)' : 'hsl(145,55%,28%)',
                          cursor: 'pointer',
                          fontWeight: selected === entry.id ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                          transition: 'background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {selected === entry.id ? (
                          <><CheckCircle size={11} /> Dipilih</>
                        ) : (
                          <>○ Slot {entry.orderInSlot} — Kosong</>
                        )}
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PANEL: Dosen — Aktivasi / Lupa Password
// ─────────────────────────────────────────────────────────────
function PanelDosen({ onBack }: { onBack: () => void }) {
  const uid = useId();
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
      <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', minHeight: 44, padding: '0 8px', marginBottom: 'var(--space-3)' }}>
        <ArrowLeft size={16} /> Kembali
      </button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 'var(--space-5)', borderBottom: '2px solid var(--color-border)' }}>
        {(['aktivasi', 'lupa'] as DosenTab[]).map((t) => (
          <button
            type="button"
            key={t}
            aria-pressed={tab === t}
            onClick={() => { setTab(t); setResult(null); }}
            style={{
              flex: '1 1 130px',
              background: 'none', border: 'none', cursor: 'pointer', padding: '10px var(--space-4)', minHeight: 44,
              fontSize: 'var(--text-sm)', fontWeight: tab === t ? 'var(--weight-bold)' : 'var(--weight-normal)',
              color: tab === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {t === 'aktivasi' ? 'Aktivasi Akun' : 'Lupa Password'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor={`${uid}-nidn`} className="form-label">NIDN / NIDK</label>
          <input id={`${uid}-nidn`} inputMode="numeric" className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} placeholder="Contoh: 0412345678" value={nidn} onChange={e => setNidn(e.target.value)} />
          <p className="form-hint">Nomor Induk Dosen Nasional atau Nomor Induk Dosen Khusus.</p>
        </div>
        <div className="form-group">
          <label htmlFor={`${uid}-nama`} className="form-label">Nama Lengkap</label>
          <input id={`${uid}-nama`} className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} placeholder="Nama sesuai dokumen resmi" value={namaLengkap} onChange={e => setNamaLengkap(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor={`${uid}-pass`} className="form-label">{tab === 'aktivasi' ? 'Buat Password Baru' : 'Password Baru'}</label>
          <input id={`${uid}-pass`} className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} type="password" placeholder="Minimal 6 karakter" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor={`${uid}-conf`} className="form-label">Konfirmasi Password</label>
          <input id={`${uid}-conf`} className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} type="password" placeholder="Ulangi password baru" value={konfirmasi} onChange={e => setKonfirmasi(e.target.value)} />
        </div>

        {result && (
          <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: result.ok ? 'var(--color-success-light)' : 'var(--color-error-light)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--text-sm)' }}>
            {result.ok ? <CheckCircle size={16} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 1 }} />}
            <span style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.msg}</span>
          </div>
        )}

        <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={loading || !nidn || !namaLengkap || !password || !konfirmasi} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}>
          {loading ? <><Loader2 size={16} className="spin-icon" /> Memproses...</> : (tab === 'aktivasi' ? 'Aktivasi Akun' : 'Reset Password')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PANEL: Mahasiswa & Mitra Luar — Daftar + Pilih Shift / Lupa NIM
// ─────────────────────────────────────────────────────────────
// Prodi resmi UNPERBA (FEB + FST) + Kategori Umum / Mitra Luar UNPERBA
const EXTERNAL_PRODI_LABEL = 'Umum / Mitra Luar UNPERBA';

const PRODI_OPTIONS: { fakultas: string; prodi: string[] }[] = [
  {
    fakultas: 'FEB — Ekonomi & Bisnis (UNPERBA)',
    prodi: ['Akuntansi', 'Manajemen'],
  },
  {
    fakultas: 'FST — Sains & Teknologi (UNPERBA)',
    prodi: ['Teknik Informatika', 'Agribisnis', 'Teknik Mesin'],
  },
  {
    fakultas: 'Non-UNPERBA / Umum',
    prodi: [EXTERNAL_PRODI_LABEL],
  },
];

function normalizeNimOrPhone(val: string): string {
  return val.trim().replace(/[\s-]/g, '').replace(/^\+62/, '0');
}

function PanelMahasiswa({ onBack }: { onBack: () => void }) {
  const uid = useId();
  const [tab, setTab] = useState<MahasiswaTab>('daftar');
  // Step daftar: 1 = isi data + PIN, 2 = pilih slot, 3 = sukses
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [nama, setNama] = useState('');
  const [nim, setNim] = useState('');
  const [prodi, setProdi] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
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

  const isExternal = prodi === EXTERNAL_PRODI_LABEL;

  function handleNextStep1() {
    setError(null);
    const cleanName = nama.trim();
    const cleanId = normalizeNimOrPhone(nim);
    const cleanPin = pin.trim();
    const cleanConfirmPin = confirmPin.trim();

    if (cleanName.length < 2) {
      setError('Nama lengkap minimal 2 karakter.');
      return;
    }
    if (!prodi) {
      setError('Pilih Program Studi atau kategori Umum / Mitra Luar UNPERBA.');
      return;
    }
    if (isExternal) {
      if (!/^\d{10,15}$/.test(cleanId)) {
        setError('Nomor HP untuk penjaga luar UNPERBA harus berupa 10 hingga 15 digit angka (contoh: 081234567890).');
        return;
      }
    } else {
      if (!/^\d{8}$/.test(cleanId)) {
        setError('NIM Mahasiswa UNPERBA harus tepat 8 digit angka (contoh: 22101010).');
        return;
      }
    }
    if (!/^\d{6,8}$/.test(cleanPin)) {
      setError('PIN baru harus berupa 6 hingga 8 digit angka (disarankan 8 angka).');
      return;
    }
    if (cleanPin !== cleanConfirmPin) {
      setError('Konfirmasi PIN tidak cocok dengan PIN baru.');
      return;
    }

    setNim(cleanId);
    setStep(2);
  }

  async function handleDaftar() {
    if (!selectedSlot) return;
    setLoading(true);
    setError(null);
    const cleanId = normalizeNimOrPhone(nim);
    try {
      const res = await fetch('/api/auth/karyawan/daftar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: nama.trim(),
          nim: cleanId,
          programStudi: prodi,
          slotId: selectedSlot,
          pin: pin.trim(),
          confirmPin: confirmPin.trim(),
        }),
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
      <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', minHeight: 44, padding: '0 8px', marginBottom: 'var(--space-3)' }}>
        <ArrowLeft size={16} /> Kembali
      </button>

      {/* Tab */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 'var(--space-5)', borderBottom: '2px solid var(--color-border)' }}>
        {([['daftar', 'Pendaftaran Jadwal Shift'], ['lupa-nim', 'Pencarian NIM / ID']] as [MahasiswaTab, string][]).map(([t, label]) => (
          <button
            type="button"
            aria-pressed={tab === t}
            key={t}
            onClick={() => { setTab(t as MahasiswaTab); setError(null); }}
            style={{
              flex: '1 1 130px',
              background: 'none', border: 'none', cursor: 'pointer', padding: '10px var(--space-4)', minHeight: 44,
              fontSize: 'var(--text-sm)', fontWeight: tab === t ? 'var(--weight-bold)' : 'var(--weight-normal)',
              color: tab === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent', marginBottom: -2,
            }}
          >{label}</button>
        ))}
      </div>

      {/* ── Tab: Daftar ── */}
      {tab === 'daftar' && (
        <div>
          {step < 3 && <StepDots total={2} current={step - 1} />}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label htmlFor={`${uid}-nama`} className="form-label">Nama Lengkap *</label>
                <input id={`${uid}-nama`} className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} placeholder="Sesuai identitas resmi" value={nama} onChange={e => setNama(e.target.value)} />
              </div>

              <div className="form-group">
                <label htmlFor={`${uid}-prodi`} className="form-label">Program Studi / Asal Instansi *</label>
                <select
                  id={`${uid}-prodi`}
                  className="form-input form-select"
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                  value={prodi}
                  onChange={e => { setProdi(e.target.value); setError(null); }}
                  required
                >
                  <option value="">— Pilih Program Studi / Kategori —</option>
                  {PRODI_OPTIONS.map((group) => (
                    <optgroup key={group.fakultas} label={group.fakultas}>
                      {group.prodi.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="form-hint">
                  Bagi staf operasional dari luar lingkungan kampus UNPERBA, pilih kategori <strong>{EXTERNAL_PRODI_LABEL}</strong>.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor={`${uid}-nim`} className="form-label">
                  {isExternal ? 'Nomor HP (Sebagai ID Login) *' : 'NIM (8 Angka) *'}
                </label>
                <input
                  id={`${uid}-nim`}
                  inputMode="numeric"
                  maxLength={isExternal ? 15 : 8}
                  className="form-input"
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                  placeholder={isExternal ? 'Contoh: 081234567890' : 'Contoh: 22101010'}
                  value={nim}
                  onChange={e => setNim(e.target.value.replace(/[^\d+-\s]/g, ''))}
                />
                <p className="form-hint">
                  {isExternal
                    ? 'Masukkan Nomor HP aktif (10–15 angka). Nomor ini digunakan sebagai ID Pengguna saat masuk ke portal operasional.'
                    : 'Masukkan 8 digit Nomor Induk Mahasiswa (NIM) resmi UNPERBA.'}
                </p>
              </div>

              <div className="form-group">
                <label htmlFor={`${uid}-pin`} className="form-label">Buat PIN Keamanan (8 Angka) *</label>
                <input
                  id={`${uid}-pin`}
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  className="form-input"
                  style={{ fontSize: 'var(--text-base)', minHeight: 44, letterSpacing: '0.15em' }}
                  placeholder="Masukkan 8 digit angka (6–8 angka)"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
                <p className="form-hint">PIN keamanan digunakan untuk autentikasi pada Terminal Kasir POS, Portal Gudang, dan Admin Shift.</p>
              </div>

              <div className="form-group">
                <label htmlFor={`${uid}-confirm-pin`} className="form-label">Konfirmasi PIN Keamanan *</label>
                <input
                  id={`${uid}-confirm-pin`}
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  className="form-input"
                  style={{ fontSize: 'var(--text-base)', minHeight: 44, letterSpacing: '0.15em' }}
                  placeholder="Masukkan kembali PIN keamanan Anda"
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
              </div>

              {error && (
                <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', display: 'flex', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleNextStep1}
                className="btn btn-primary"
                disabled={!nama.trim() || !nim.trim() || !prodi || !pin.trim() || !confirmPin.trim()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}
              >
                Lanjut Pilih Jadwal Shift <ChevronRight size={16} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <span><strong>{nama}</strong> · {isExternal ? `No. HP ${nim}` : `NIM ${nim}`} · {prodi} · PIN {pin.length} digit</span>
                <button type="button" onClick={() => setStep(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 'var(--text-xs)', fontWeight: 600, minHeight: 44, padding: '0 8px', display: 'inline-flex', alignItems: 'center' }}>Ubah Data</button>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Pilih slot jadwal operasional yang <strong>tersedia</strong>:
              </p>
              <ShiftGrid onSelect={setSelectedSlot} selected={selectedSlot} />
              {error && (
                <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', display: 'flex', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: 1, minWidth: 100, minHeight: 44 }}>Kembali</button>
                <button
                  type="button"
                  onClick={handleDaftar}
                  className="btn btn-primary"
                  disabled={!selectedSlot || loading}
                  style={{ flex: 2, minWidth: 160, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {loading ? <><Loader2 size={16} className="spin-icon" /> Memproses Pendaftaran...</> : 'Selesaikan Pendaftaran'}
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
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                Silakan masuk menggunakan <strong>{isExternal ? `Nomor HP (${nim})` : `NIM (${nim})`}</strong> dan <strong>PIN {pin.length} digit</strong> yang telah Anda daftarkan.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
                <a href="/kasir/login" className="btn btn-primary" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 1, minWidth: 160 }}>Masuk ke Kasir POS →</a>
                <a href="/login" className="btn btn-secondary" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 1, minWidth: 160 }}>Masuk ke Portal Admin →</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Lupa NIM ── */}
      {tab === 'lupa-nim' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Masukkan Nama Lengkap dan Program Studi sesuai data akademik untuk menampilkan Nomor Induk Mahasiswa (NIM) atau ID Pengguna Anda.
            Apabila data belum ditemukan, silakan hubungi Pengelola Wiramart atau Ketua Program Studi.
          </p>
          <div className="form-group">
            <label htmlFor={`${uid}-lupa-nama`} className="form-label">Nama Lengkap</label>
            <input id={`${uid}-lupa-nama`} className="form-input" style={{ fontSize: 'var(--text-base)', minHeight: 44 }} placeholder="Sesuai data pendaftaran" value={lupaName} onChange={e => setLupaName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor={`${uid}-lupa-prodi`} className="form-label">Program Studi</label>
            <select
              id={`${uid}-lupa-prodi`}
              className="form-input form-select"
              style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
              value={lupaProdi}
              onChange={e => setLupaProdi(e.target.value)}
            >
              <option value="">— Pilih Program Studi —</option>
              {PRODI_OPTIONS.map((group) => (
                <optgroup key={group.fakultas} label={group.fakultas}>
                  {group.prodi.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </optgroup>
              ))}
            </select>
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
            type="button"
            onClick={handleCariNim}
            className="btn btn-primary"
            disabled={lupaLoading || !lupaName || !lupaProdi}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 }}
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

  // Prefetch jadwal slot saat halaman /daftar dibuka agar Langkah 2 tampil 0ms tanpa loading
  useEffect(() => {
    if (scheduleSlotsMemCache.length > 0) return;
    const controller = new AbortController();
    fetch('/api/publik/jadwal-slot', { signal: controller.signal })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: { schedule: DayGroup[] } }) => {
        if (!controller.signal.aborted && j.success && j.data) {
          scheduleSlotsMemCache = j.data.schedule;
        }
      })
      .catch(() => {
        // silent prefetch
      });
    return () => controller.abort();
  }, []);

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)',
      padding: 'calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom, 0px))',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div style={{ width: 64, height: 64, position: 'relative', margin: '0 auto var(--space-2)' }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              fill
              sizes="64px"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
            Wiramart UNPERBA
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            {mode === 'choose'
              ? 'Portal Registrasi & Aktivasi Akun Resmi'
              : mode === 'dosen'
                ? 'Portal Dosen Pembimbing & Pengelola'
                : 'Portal Registrasi Mahasiswa & Staf Operasional'}
          </p>
        </div>

        <div className="card">
          <div className="card-body">
            {mode === 'choose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: 'var(--space-2)' }}>
                  Pilih Kategori Pendaftaran Pengguna:
                </p>
                <button
                  type="button"
                  onClick={() => setMode('dosen')}
                  style={{
                    width: '100%',
                    padding: 'var(--space-5)', border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                    transition: 'border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                >
                  <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <GraduationCap size={22} style={{ color: 'var(--color-primary)' }} />
                  </span>
                  <span style={{ display: 'block', minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', marginBottom: 2 }}>Dosen Pembimbing / Pengelola</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Aktivasi akun atau pengaturan ulang kata sandi menggunakan NIDN/NIDK</span>
                  </span>
                  <ChevronRight size={18} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--color-text-muted)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setMode('mahasiswa')}
                  style={{
                    width: '100%',
                    padding: 'var(--space-5)', border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                    transition: 'border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                >
                  <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-info-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Users size={22} style={{ color: 'var(--color-info)' }} />
                  </span>
                  <span style={{ display: 'block', minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', marginBottom: 2 }}>Mahasiswa & Staf Operasional</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Pendaftaran jadwal shift operasional atau pencarian NIM/ID terdaftar</span>
                  </span>
                  <ChevronRight size={18} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--color-text-muted)' }} />
                </button>

                <div style={{ textAlign: 'center', paddingTop: 'var(--space-2)' }}>
                  <a href="/login" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '8px 12px', gap: 4 }}>
                    Sudah memiliki akun terdaftar? <span style={{ color: 'var(--color-primary)' }}>Masuk ke Portal</span>
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
