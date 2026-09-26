'use client';

import { useState, useId, useEffect } from 'react';
import Image from 'next/image';
import {
  Eye, EyeOff, LogIn, AlertCircle,
  ShieldCheck, GraduationCap, User, Hash, BookOpen,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Unified Login Page — Admin + Karyawan dalam satu halaman
// Toggle role: Admin (username + password) | Karyawan (Nama + NIM + Prodi)
// ─────────────────────────────────────────────────────────────
type Role = 'admin' | 'kasir';

export default function LoginPage() {
  const uid = useId();
  const [role, setRole] = useState<Role>('kasir');

  // Admin state
  const [nidn, setNidn] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Kasir state
  const [fullName, setFullName] = useState('');
  const [nim, setNim] = useState('');
  const [programStudi, setProgramStudi] = useState('');

  // Shared state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form + error saat ganti role
  useEffect(() => {
    setError(null);
    setNidn(''); setPassword('');
    setFullName(''); setNim(''); setProgramStudi('');
  }, [role]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (role === 'admin') {
      if (!nidn.trim() || !password.trim()) {
        setError('NIDN/NIDK dan password wajib diisi.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch('/api/auth/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nidn: nidn.trim(), password }),
        });
        const json = await res.json() as {
          success: boolean;
          data?: { redirect?: string };
          error?: string;
        };
        if (!res.ok || !json.success) {
          setError(json.error ?? 'Username atau password salah.');
          return;
        }
        window.location.href = json.data?.redirect ?? '/admin/dashboard';
      } catch {
        setError('Koneksi gagal. Periksa jaringan Anda.');
      } finally {
        setIsLoading(false);
      }
    } else {
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

  return (
    <div className="auth-wrapper">
      <main className="auth-card" role="main">

        {/* ── Logo ─────────────────────────────────────────── */}
        <div className="auth-logo">
          <div style={{ width: 72, height: 72, position: 'relative', flexShrink: 0 }}>
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

        {/* ── Role Toggle ──────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Pilih jenis akun"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            backgroundColor: 'var(--color-surface-alt)',
            borderRadius: 'var(--radius-lg)',
            padding: 4,
            marginBottom: 'var(--space-6)',
          }}
        >
          {([
            { id: 'kasir', label: 'Karyawan', icon: <GraduationCap size={16} aria-hidden="true" /> },
            { id: 'admin', label: 'Admin',    icon: <ShieldCheck size={16} aria-hidden="true" /> },
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
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'calc(var(--radius-lg) - 2px)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                fontFamily: 'var(--font-sans)',
                transition: 'all var(--duration-fast) ease',
                backgroundColor: role === tab.id ? 'var(--color-primary)' : 'transparent',
                color: role === tab.id ? 'white' : 'var(--color-text-muted)',
                boxShadow: role === tab.id ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Heading ─────────────────────────────────────── */}
        <div style={{ marginBottom: 'var(--space-5)', textAlign: 'center' }}>
          <h1 className="auth-title" style={{ marginBottom: 'var(--space-1)' }}>
            {role === 'admin' ? 'Masuk sebagai Admin' : 'Masuk sebagai Karyawan'}
          </h1>
          <p className="auth-subtitle">
            {role === 'admin'
              ? 'Kelola produk, laporan, dan pengaturan sistem.'
              : 'Sesi kerja Anda akan tercatat otomatis saat login dan logout.'}
          </p>
        </div>

        {/* ── Error Alert ─────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--color-error-light)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
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
          {role === 'admin' ? (
            <>
              {/* Username */}
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-nidn`}>
                  NIDN / NIDK <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id={`${uid}-nidn`}
                  name="admin_nidn_login"
                  type="text"
                  className="form-input"
                  placeholder="Nomor Induk Dosen"
                  value={nidn}
                  onChange={(e) => setNidn(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  required
                  aria-required="true"
                  disabled={isLoading}
                />
              </div>

              {/* Password */}
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-password`}>
                  Password <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id={`${uid}-password`}
                    name="admin_password_auth"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    required
                    aria-required="true"
                    disabled={isLoading}
                    style={{ paddingRight: 'var(--space-10)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    disabled={isLoading}
                    style={{
                      position: 'absolute', right: 'var(--space-3)',
                      top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-muted)', display: 'flex',
                      alignItems: 'center', padding: 'var(--space-1)', minHeight: 0,
                    }}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Nama Lengkap */}
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-name`}>
                  Nama Lengkap <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={15} aria-hidden="true" style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-name`}
                    name="staff_name"
                    type="text"
                    className="form-input"
                    placeholder="Sesuai data yang terdaftar"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="words"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    required
                    aria-required="true"
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))' }}
                  />
                </div>
              </div>

              {/* NIM */}
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-nim`}>
                  NIM <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash size={15} aria-hidden="true" style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-nim`}
                    type="text"
                    className="form-input"
                    placeholder="Nomor Induk Mahasiswa"
                    value={nim}
                    onChange={(e) => setNim(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    inputMode="text"
                    required
                    aria-required="true"
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              {/* Program Studi */}
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-prodi`}>
                  Program Studi <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <BookOpen size={15} aria-hidden="true" style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-prodi`}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Manajemen"
                    value={programStudi}
                    onChange={(e) => setProgramStudi(e.target.value)}
                    autoComplete="off"
                    required
                    aria-required="true"
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 15px + var(--space-2))' }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Submit */}
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
                {role === 'admin' ? 'Masuk sebagai Admin' : 'Mulai Sesi Kerja'}
              </>
            )}
          </button>
        </form>

        {/* ── Footer info ─────────────────────────────────── */}
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
              Belum terdaftar?{' '}
              <a href="/daftar" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>
                Daftar &amp; Pilih Shift →
              </a>
            </>
          ) : (
            <>
              Belum aktivasi atau lupa password?{' '}
              <a href="/daftar" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>
                Aktivasi Akun →
              </a>
            </>
          )}

        </p>
      </main>
    </div>
  );
}
