'use client';

import { useState, useId, useEffect } from 'react';
import Image from 'next/image';
import {
  Eye, EyeOff, LogIn, AlertCircle, CheckCircle2,
  ShieldCheck, Hash, KeyRound, Building2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Portal Login Pengelola Wiramart UNPERBA:
// 1. Admin Kasir / Ketua Admin (Mahasiswa Pengelola): NIM + PIN 6-Digit
// 2. Manager (Dosen Pembimbing / Owner): NIDN + Password
// (Petugas Kasir lapangan dialokasikan khusus ke /kasir/login)
// ─────────────────────────────────────────────────────────────
type Role = 'admin_shift' | 'manager';

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
    }
  }

  // Handle Submit Buat PIN Baru
  async function handleSetupPinSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!setupPinData) return;

    if (newPin.length < 6 || newPin.length > 8) {
      setSetupPinError('PIN harus berupa 6 hingga 8 digit angka.');
      return;
    }
    if (newPin !== confirmPin) {
      setSetupPinError('Konfirmasi PIN tidak cocok.');
      return;
    }

    setSetupPinLoading(true);
    setSetupPinError(null);

    try {
      const res = await fetch('/api/auth/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nim: setupPinData.nim,
          pin: newPin,
        }),
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
          <div style={{ width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              width={68}
              height={68}
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div>
            <div className="auth-logo-name">WIRAMART UNPERBA</div>
            <div className="auth-logo-sub">Portal Pengelola Toko &amp; Manajemen</div>
          </div>
        </div>

        {/* ── 2-Way Role Switcher: Admin Kasir vs Manager Dosen ──────────────── */}
        <div
          role="tablist"
          aria-label="Pilih jenis login pengelola"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            backgroundColor: 'var(--color-surface-alt, #f1f5f9)',
            borderRadius: 'var(--radius-lg)',
            padding: 4,
            marginBottom: 'var(--space-5)',
          }}
        >
          {([
            { id: 'admin_shift', label: 'Admin Kasir', icon: <ShieldCheck size={16} aria-hidden="true" /> },
            { id: 'manager',     label: 'Manager Dosen', icon: <Building2 size={16} aria-hidden="true" /> },
          ] as { id: Role; label: string; icon: React.ReactNode }[]).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={role === tab.id}
              type="button"
              onClick={() => setRole(tab.id)}
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: role === tab.id ? 'var(--weight-bold)' : 'var(--weight-medium)',
                backgroundColor: role === tab.id ? 'var(--color-surface, #ffffff)' : 'transparent',
                color: role === tab.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                boxShadow: role === tab.id ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Role Description ──────────────────────────────── */}
        <div
          style={{
            backgroundColor: 'var(--color-surface-muted, #f8fafc)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {role === 'admin_shift' ? (
            <>
              <ShieldCheck size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              <span>
                <strong>Admin Kasir / Ketua Admin:</strong> Kelola katalog, stok barang, roster shift, dan audit kasir.
              </span>
            </>
          ) : (
            <>
              <Building2 size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              <span>
                <strong>Manager Dosen:</strong> Supervisi laporan keuangan, bagi hasil, dan rekap kehadiran UKM.
              </span>
            </>
          )}
        </div>

        {/* ── Global Alert: Error ──────────────────────────── */}
        {error && (
          <div
            role="alert"
            className="alert alert-error"
            style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Global Alert: Sukses ─────────────────────────── */}
        {successMsg && (
          <div
            role="status"
            className="alert alert-success"
            style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <CheckCircle2 size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── Form Utama ───────────────────────────────────── */}
        <form onSubmit={handleSubmit} noValidate>

          {/* TAB 1: ADMIN KASIR / KETUA ADMIN (NIM + PIN 6-DIGIT) */}
          {role === 'admin_shift' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-admin-nim`}>
                  NIM Admin Kasir <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-admin-nim`}
                    type="text"
                    inputMode="numeric"
                    className="form-input"
                    placeholder="Contoh: 02301001"
                    value={adminShiftNim}
                    onChange={(e) => setAdminShiftNim(e.target.value)}
                    autoComplete="username"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" htmlFor={`${uid}-admin-pin`}>
                    PIN Pengelola (8 Digit) <span className="required" aria-hidden="true">*</span>
                  </label>
                </div>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={15} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-admin-pin`}
                    type={showAdminShiftPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={8}
                    className="form-input"
                    placeholder="Masukkan 8-digit PIN (contoh: 02405013)"
                    value={adminShiftPin}
                    onChange={(e) => setAdminShiftPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    autoComplete="current-password"
                    disabled={isLoading}
                    style={{
                      paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))',
                      paddingRight: 'var(--space-10)',
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: showAdminShiftPin ? '2px' : '4px',
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
                    autoComplete="username"
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
                    autoComplete="current-password"
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
                {role === 'admin_shift' ? 'Masuk sebagai Admin Kasir' : 'Masuk sebagai Manager'}
              </>
            )}
          </button>
        </form>

        {/* ── Footer Link: Pengalihan Khusus Petugas Kasir ──────────────── */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Bertugas menjaga kasir hari ini?
          </p>
          <a
            href="/kasir/login"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-primary)',
              fontWeight: 'var(--weight-semibold)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            &larr; Buka Portal Presensi &amp; Shift Kasir
          </a>
        </div>
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
                Buat PIN Baru (8 Digit Angka)
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
                  PIN Baru (8 Digit Angka) <span className="required">*</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  className="form-input"
                  placeholder="8 digit angka (contoh: 02405013)"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  required
                  disabled={setupPinLoading}
                  style={{ textAlign: 'center', letterSpacing: '4px', fontFamily: 'var(--font-mono)', fontSize: 16 }}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 11 }}>
                  Ulangi PIN Baru (8 Digit) <span className="required">*</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  className="form-input"
                  placeholder="Ketik ulang 8 digit"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
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
                  disabled={setupPinLoading || newPin.length < 6 || confirmPin.length < 6}
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
