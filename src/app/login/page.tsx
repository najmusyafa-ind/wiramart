'use client';

import { useState, useId, useEffect } from 'react';
import Image from 'next/image';
import {
  Eye, EyeOff, LogIn, AlertCircle, CheckCircle2,
  ShieldCheck, GraduationCap, User, Hash, BookOpen, KeyRound, Building2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Unified Login Page — Mendukung 3 Role Resmi:
// 1. Karyawan (Kasir POS): Nama + NIM + Prodi
// 2. Admin Kasir (Admin Shift / Kepala Admin): NIM + PIN 6-Digit
// 3. Manager (Dosen / Owner): NIDN + Password
// ─────────────────────────────────────────────────────────────
type Role = 'kasir' | 'admin_shift' | 'manager';

type SetupPinData = {
  nim: string;
  fullName: string;
  jabatan: string;
};

export default function LoginPage() {
  const uid = useId();
  const [role, setRole] = useState<Role>('admin_shift');

  // State: Admin Kasir / Admin Shift (NIM + PIN)
  const [adminShiftNim, setAdminShiftNim] = useState('');
  const [adminShiftPin, setAdminShiftPin] = useState('');
  const [showAdminShiftPin, setShowAdminShiftPin] = useState(false);

  // State: Manager Dosen (NIDN + Password)
  const [managerNidn, setManagerNidn] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showManagerPassword, setShowManagerPassword] = useState(false);

  // State: Karyawan Kasir POS (Nama + NIM + Prodi)
  const [fullName, setFullName] = useState('');
  const [nim, setNim] = useState('');
  const [programStudi, setProgramStudi] = useState('');

  // Shared state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // State Modal Setup PIN (Untuk Admin Shift yang belum membuat PIN)
  const [setupPinData, setSetupPinData] = useState<SetupPinData | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setupPinLoading, setSetupPinLoading] = useState(false);
  const [setupPinError, setSetupPinError] = useState<string | null>(null);

  // Reset form + error saat ganti role
  useEffect(() => {
    setError(null);
    setSuccessMsg(null);
  }, [role]);

  // Handle Login
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // ── ROLE 1: ADMIN KASIR (NIM + PIN 6-DIGIT) ──
    if (role === 'admin_shift') {
      const trimmedNim = adminShiftNim.trim();
      const trimmedPin = adminShiftPin.trim();

      if (!trimmedNim) {
        setError('NIM Admin Kasir wajib diisi.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch('/api/auth/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nidn: trimmedNim, password: trimmedPin }),
        });

        const json = await res.json() as {
          success: boolean;
          code?: string;
          data?: { redirect?: string; nim?: string; fullName?: string; jabatan?: string };
          error?: string;
          message?: string;
        };

        // KASUS KHUSUS: Belum memiliki PIN (Akun Baru / Belum Inisialisasi)
        if (json.code === 'NEED_SETUP_PIN' && json.data) {
          setSetupPinData({
            nim: json.data.nim ?? trimmedNim,
            fullName: json.data.fullName ?? 'Admin Shift',
            jabatan: json.data.jabatan ?? 'Kepala Admin',
          });
          setNewPin('');
          setConfirmPin('');
          setSetupPinError(null);
          return;
        }

        if (!res.ok || !json.success) {
          setError(json.error ?? json.message ?? 'NIM atau PIN salah.');
          return;
        }

        window.location.href = json.data?.redirect ?? '/admin/dashboard';
      } catch {
        setError('Koneksi gagal. Periksa jaringan Anda.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── ROLE 2: MANAGER DOSEN (NIDN + PASSWORD) ──
    if (role === 'manager') {
      const trimmedNidn = managerNidn.trim();
      if (!trimmedNidn || !managerPassword.trim()) {
        setError('NIDN dan password Manager wajib diisi.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch('/api/auth/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nidn: trimmedNidn, password: managerPassword }),
        });
        const json = await res.json() as {
          success: boolean;
          data?: { redirect?: string };
          error?: string;
        };
        if (!res.ok || !json.success) {
          setError(json.error ?? 'NIDN atau password Manager salah.');
          return;
        }
        window.location.href = json.data?.redirect ?? '/admin/dashboard';
      } catch {
        setError('Koneksi gagal. Periksa jaringan Anda.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── ROLE 3: KARYAWAN KASIR POS (NAMA + NIM + PRODI) ──
    if (role === 'kasir') {
      if (!fullName.trim() || !nim.trim() || !programStudi.trim()) {
        setError('Nama Lengkap, NIM, dan Program Studi wajib diisi.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch('/api/auth/kasir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            nim: nim.trim(),
            programStudi: programStudi.trim(),
          }),
        });
        const json = await res.json() as {
          success: boolean;
          data?: { redirect?: string };
          error?: string;
        };
        if (!res.ok || !json.success) {
          setError(json.error ?? 'Data tidak ditemukan. Periksa kembali Nama, NIM, dan Program Studi.');
          return;
        }
        window.location.href = json.data?.redirect ?? '/kasir/pos';
      } catch {
        setError('Koneksi gagal. Periksa jaringan Anda.');
      } finally {
        setIsLoading(false);
      }
    }
  }

  // Handle Submit Buat PIN Baru
  async function handleSetupPinSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!setupPinData) return;

    setSetupPinError(null);

    if (!/^\d{6}$/.test(newPin)) {
      setSetupPinError('PIN wajib tepat 6 digit angka.');
      return;
    }

    if (newPin !== confirmPin) {
      setSetupPinError('Konfirmasi PIN tidak cocok dengan PIN baru.');
      return;
    }

    setSetupPinLoading(true);
    try {
      const res = await fetch('/api/auth/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nim: setupPinData.nim, pin: newPin }),
      });

      const json = await res.json() as {
        success: boolean;
        message?: string;
        error?: string;
        data?: { redirect?: string };
      };

      if (!res.ok || !json.success) {
        setSetupPinError(json.error ?? 'Gagal membuat PIN.');
        return;
      }

      setSuccessMsg(json.message ?? 'PIN berhasil dibuat! Mengalihkan ke dashboard...');
      setSetupPinData(null);
      setTimeout(() => {
        window.location.href = json.data?.redirect ?? '/admin/dashboard';
      }, 700);
    } catch {
      setSetupPinError('Koneksi terputus saat menyimpan PIN.');
    } finally {
      setSetupPinLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <main className="auth-card" role="main" style={{ maxWidth: 440 }}>

        {/* ── Logo ─────────────────────────────────────────── */}
        <div className="auth-logo">
          <div style={{ width: 68, height: 68, position: 'relative', flexShrink: 0 }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div>
            <div className="auth-logo-name">WIRAMART UNPERBA</div>
            <div className="auth-logo-sub">Unit Kegiatan Mahasiswa Kewirausahaan</div>
          </div>
        </div>

        {/* ── 3-Way Role Switcher ──────────────────────────── */}
        <div
          role="tablist"
          aria-label="Pilih jenis login"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 4,
            backgroundColor: 'var(--color-surface-alt, #f1f5f9)',
            borderRadius: 'var(--radius-lg)',
            padding: 4,
            marginBottom: 'var(--space-5)',
          }}
        >
          {([
            { id: 'admin_shift', label: 'Admin Kasir', icon: <ShieldCheck size={15} aria-hidden="true" /> },
            { id: 'manager',     label: 'Manager',     icon: <Building2 size={15} aria-hidden="true" /> },
            { id: 'kasir',       label: 'Karyawan',    icon: <GraduationCap size={15} aria-hidden="true" /> },
          ] as { id: Role; label: string; icon: React.ReactNode }[]).map((tab) => (
            <button
              key={tab.id}
              id={`${uid}-tab-${tab.id}`}
              role="tab"
              aria-selected={role === tab.id}
              aria-controls={`${uid}-panel-${tab.id}`}
              type="button"
              onClick={() => setRole(tab.id)}
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '8px 6px',
                borderRadius: 'calc(var(--radius-lg) - 2px)',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: role === tab.id ? 'var(--weight-bold)' : 'var(--weight-medium)',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                backgroundColor: role === tab.id ? 'var(--color-primary)' : 'transparent',
                color: role === tab.id ? 'white' : 'var(--color-text-muted)',
                boxShadow: role === tab.id ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Heading ─────────────────────────────────────── */}
        <div style={{ marginBottom: 'var(--space-4)', textAlign: 'center' }}>
          <h1 className="auth-title" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
            {role === 'admin_shift' && 'Masuk sebagai Admin Kasir'}
            {role === 'manager' && 'Masuk sebagai Manager (Dosen)'}
            {role === 'kasir' && 'Masuk sebagai Karyawan Kasir'}
          </h1>
          <p className="auth-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
            {role === 'admin_shift' && 'Khusus Mahasiswa Koordinator Shift (Gunakan NIM & PIN 6-Digit).'}
            {role === 'manager' && 'Khusus Dosen Pembina & Owner UKM (Gunakan NIDN & Password).'}
            {role === 'kasir' && 'Petugas pelaksana kasir membuka sesi POS toko.'}
          </p>
        </div>

        {/* ── Success Alert ────────────────────────────────── */}
        {successMsg && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '10px 12px',
              backgroundColor: 'var(--color-success-light, #dcfce7)',
              border: '1px solid var(--color-success)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
              color: 'var(--color-success)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── Error Alert ─────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              padding: '10px 12px',
              backgroundColor: 'var(--color-error-light)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────── */}
        <form
          id={`${uid}-panel-${role}`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${role}`}
          className="auth-form"
          onSubmit={handleSubmit}
          noValidate
          autoComplete="off"
        >
          {/* TAB 1: ADMIN KASIR (NIM + PIN 6-DIGIT) */}
          {role === 'admin_shift' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-admin-shift-nim`}>
                  NIM Admin Kasir <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-admin-shift-nim`}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 02301001"
                    value={adminShiftNim}
                    onChange={(e) => setAdminShiftNim(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" htmlFor={`${uid}-admin-shift-pin`} style={{ margin: 0 }}>
                    PIN 6-Digit <span className="required" aria-hidden="true">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!adminShiftNim.trim()) {
                        setError('Masukkan NIM Anda terlebih dahulu untuk mengatur PIN.');
                        return;
                      }
                      // Panggil pengecekan NIM
                      fetch('/api/auth/admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nidn: adminShiftNim.trim(), checkOnly: true }),
                      })
                        .then(r => r.json())
                        .then(j => {
                          if (j.success && j.data?.exists) {
                            setSetupPinData({
                              nim: adminShiftNim.trim(),
                              fullName: j.data.fullName,
                              jabatan: j.data.jabatan ?? 'Kepala Admin',
                            });
                          } else {
                            setError('NIM tidak terdaftar sebagai Admin Shift / Kepala Admin.');
                          }
                        });
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: 11,
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      fontWeight: 'var(--weight-semibold)',
                    }}
                  >
                    Belum punya PIN?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-admin-shift-pin`}
                    type={showAdminShiftPin ? 'text' : 'password'}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="form-input"
                    placeholder="Masukkan 6-digit PIN"
                    value={adminShiftPin}
                    onChange={(e) => setAdminShiftPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="new-password"
                    disabled={isLoading}
                    style={{
                      paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))',
                      paddingRight: 'var(--space-10)',
                      letterSpacing: showAdminShiftPin ? '2px' : '4px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminShiftPin((v) => !v)}
                    aria-label={showAdminShiftPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    disabled={isLoading}
                    style={{
                      position: 'absolute', right: 'var(--space-3)',
                      top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-muted)', display: 'flex',
                      alignItems: 'center', padding: 'var(--space-1)', minHeight: 0,
                    }}
                  >
                    {showAdminShiftPin ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: MANAGER DOSEN (NIDN + PASSWORD) */}
          {role === 'manager' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-manager-nidn`}>
                  NIDN / Akun Dosen <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Building2 size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-manager-nidn`}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 0612345678"
                    value={managerNidn}
                    onChange={(e) => setManagerNidn(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-manager-password`}>
                  Password Manager <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id={`${uid}-manager-password`}
                    type={showManagerPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Password Akun Dosen"
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    style={{ paddingRight: 'var(--space-10)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowManagerPassword((v) => !v)}
                    aria-label={showManagerPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    disabled={isLoading}
                    style={{
                      position: 'absolute', right: 'var(--space-3)',
                      top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-muted)', display: 'flex',
                      alignItems: 'center', padding: 'var(--space-1)', minHeight: 0,
                    }}
                  >
                    {showManagerPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: KARYAWAN KASIR POS (NAMA + NIM + PRODI) */}
          {role === 'kasir' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-name`}>
                  Nama Lengkap <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-name`}
                    type="text"
                    className="form-input"
                    placeholder="Sesuai jadwal yang terdaftar"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="words"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-nim`}>
                  NIM <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-nim`}
                    type="text"
                    className="form-input"
                    placeholder="Nomor Induk Mahasiswa"
                    value={nim}
                    onChange={(e) => setNim(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-prodi`}>
                  Program Studi <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <BookOpen size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-prodi`}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Manajemen / Informatika"
                    value={programStudi}
                    onChange={(e) => setProgramStudi(e.target.value)}
                    autoComplete="off"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))' }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className={`btn btn-primary btn-full btn-lg ${isLoading ? 'btn-loading' : ''}`}
            disabled={isLoading}
            aria-busy={isLoading}
            style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
          >
            {!isLoading && (
              <>
                <LogIn size={18} aria-hidden="true" />
                {role === 'admin_shift' && 'Masuk sebagai Admin Kasir'}
                {role === 'manager' && 'Masuk sebagai Manager'}
                {role === 'kasir' && 'Buka Sesi Kerja POS'}
              </>
            )}
          </button>
        </form>

        {/* ── Footer Link ─────────────────────────────────── */}
        <p
          style={{
            marginTop: 'var(--space-5)',
            textAlign: 'center',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {role === 'kasir' ? (
            <>
              Belum terdaftar di jadwal?{' '}
              <a href="/daftar" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>
                Daftar &amp; Pilih Shift →
              </a>
            </>
          ) : (
            <>
              Ingin absen shift bersama tim?{' '}
              <a href="/kasir/login" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>
                Buka Kiosk Presensi Shift →
              </a>
            </>
          )}
        </p>
      </main>

      {/* ── MODAL SETUP PIN (JIKA ADMIN SHIFT BELUM BIKIN PIN) ── */}
      {setupPinData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 'var(--space-4)',
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 400,
              width: '100%',
              backgroundColor: 'white',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-6)',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px',
                }}
              >
                <KeyRound size={24} />
              </div>
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                Buat PIN 6-Digit Baru
              </h2>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Halo <strong>{setupPinData.fullName}</strong>! Akun Anda ({setupPinData.jabatan}) belum memiliki PIN pengelola.
              </p>
            </div>

            {setupPinError && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  backgroundColor: 'var(--color-error-light)',
                  border: '1px solid var(--color-error)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  color: 'var(--color-error)',
                  fontSize: 11,
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{setupPinError}</span>
              </div>
            )}

            <form onSubmit={handleSetupPinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 11 }}>
                  PIN Baru (6 Digit Angka) <span className="required">*</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className="form-input"
                  placeholder="Contoh: 123456"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={setupPinLoading}
                  style={{ textAlign: 'center', letterSpacing: '4px', fontFamily: 'var(--font-mono)', fontSize: 16 }}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 11 }}>
                  Ulangi PIN Baru <span className="required">*</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className="form-input"
                  placeholder="Ketik ulang 6 digit"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={setupPinLoading}
                  style={{ textAlign: 'center', letterSpacing: '4px', fontFamily: 'var(--font-mono)', fontSize: 16 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setSetupPinData(null)}
                  className="btn btn-secondary"
                  disabled={setupPinLoading}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 'var(--text-xs)' }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={setupPinLoading || newPin.length !== 6 || confirmPin.length !== 6}
                  style={{ flex: 2, padding: '8px 12px', fontSize: 'var(--text-xs)', fontWeight: 'bold' }}
                >
                  {setupPinLoading ? 'Menyimpan...' : 'Simpan PIN & Masuk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
