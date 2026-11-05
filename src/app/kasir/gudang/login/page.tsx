'use client';

// =============================================================
// src/app/kasir/gudang/login/page.tsx
// Gerbang Keamanan Petugas Gudang & Logistik Wiramart UNPERBA
// Standar: Vanilla CSS Design System, WCAG 2.1 AAA, Zero-Trust Architecture
// =============================================================

import { useState, useId } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  KeyRound,
  ShieldCheck,
  User,
  GraduationCap,
  Hash,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';

export default function GudangLoginPage() {
  const router = useRouter();

  // Mode: 'login' (NIM + PIN) | 'setup' (Buat PIN Mandiri)
  const [mode, setMode] = useState<'login' | 'setup'>('login');

  // Form State Login
  const [loginForm, setLoginForm] = useState({
    nim: '',
    pin: '',
  });

  // Form State Setup PIN
  const [setupForm, setSetupForm] = useState({
    fullName: '',
    nim: '',
    programStudi: '',
    pin: '',
    confirmPin: '',
  });

  // UI State
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Accessible IDs
  const loginNimId = useId();
  const loginPinId = useId();
  const setupNameId = useId();
  const setupNimId = useId();
  const setupProdiId = useId();
  const setupPinId = useId();
  const setupConfirmPinId = useId();

  // Handle Login Petugas
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!loginForm.nim.trim() || !loginForm.pin.trim()) {
      setErrorMsg('NIM dan PIN wajib diisi.');
      return;
    }

    if (!/^\d{6,8}$/.test(loginForm.pin)) {
      setErrorMsg('PIN harus terdiri dari 6 hingga 8 digit angka.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/gudang/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        // Jika akun belum punya PIN -> tawarkan setup PIN mandiri
        if (json.needSetupPin) {
          setErrorMsg(json.message);
          setSetupForm((prev) => ({
            ...prev,
            nim: json.data?.nim || loginForm.nim,
            fullName: json.data?.fullName || '',
            programStudi: json.data?.programStudi || '',
          }));
          setTimeout(() => {
            setMode('setup');
          }, 1500);
          return;
        }

        setErrorMsg(json.error ?? 'Gagal masuk ke sistem gudang.');
        return;
      }

      setSuccessMsg(`Otorisasi berhasil. Mengalihkan ke Portal Gudang...`);
      setTimeout(() => {
        router.push('/kasir/gudang');
        router.refresh();
      }, 800);
    } catch {
      setErrorMsg('Terjadi kesalahan jaringan. Periksa koneksi internet Anda.');
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Setup PIN Mandiri
  async function handleSetupPin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!setupForm.fullName.trim() || !setupForm.nim.trim() || !setupForm.programStudi.trim()) {
      setErrorMsg('Nama lengkap, NIM, dan Program Studi wajib diisi untuk verifikasi identitas.');
      return;
    }

    if (!/^\d{6,8}$/.test(setupForm.pin)) {
      setErrorMsg('PIN baru harus berupa 6 hingga 8 digit angka.');
      return;
    }

    if (setupForm.pin !== setupForm.confirmPin) {
      setErrorMsg('Konfirmasi PIN tidak cocok dengan PIN baru.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/gudang/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupForm),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setErrorMsg(json.error ?? 'Verifikasi identitas gagal. Periksa kembali nama asli dan prodi.');
        return;
      }

      setSuccessMsg(json.data?.message ?? 'PIN berhasil dibuat! Mengalihkan ke Portal Gudang...');
      setTimeout(() => {
        router.push('/kasir/gudang');
        router.refresh();
      }, 1000);
    } catch {
      setErrorMsg('Terjadi kesalahan koneksi server.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <main
        className="auth-card"
        role="main"
        style={{
          maxWidth: mode === 'setup' ? 460 : 420,
          transition: 'max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Identitas & Logo */}
        <div className="auth-logo" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ width: 64, height: 64, position: 'relative' }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              fill
              sizes="64px"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="auth-logo-name" style={{ fontSize: '1.15rem' }}>
              PORTAL PETUGAS GUDANG
            </div>
            <div className="auth-logo-sub" style={{ fontSize: '0.78rem' }}>
              Otorisasi Keamanan Logistik &amp; Manajemen FEFO
            </div>
          </div>
        </div>

        {/* Tab Navigation Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            backgroundColor: 'var(--color-surface-muted, #f1f5f9)',
            borderRadius: 'var(--radius-lg)',
            padding: 4,
            marginBottom: 'var(--space-5)',
            gap: 4,
          }}
          role="tablist"
        >
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: mode === 'login' ? 'var(--weight-bold)' : 'var(--weight-medium)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: mode === 'login' ? 'white' : 'transparent',
              color: mode === 'login' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              boxShadow: mode === 'login' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <KeyRound size={15} />
            <span>Masuk dengan PIN</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('setup');
              setErrorMsg(null);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: mode === 'setup' ? 'var(--weight-bold)' : 'var(--weight-medium)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: mode === 'setup' ? 'white' : 'transparent',
              color: mode === 'setup' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              boxShadow: mode === 'setup' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <ShieldCheck size={15} />
            <span>Buat PIN Mandiri</span>
          </button>
        </div>

        {/* Notifikasi Alert Error / Sukses */}
        {errorMsg && (
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
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
              lineHeight: 1.45,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--color-success-light)',
              border: '1px solid var(--color-success)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
              color: 'var(--color-success)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── MODE 1: LOGIN (NIM + PIN MANDIRI) ── */}
        {mode === 'login' ? (
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 className="auth-title" style={{ fontSize: '1.25rem' }}>
                Login Petugas Gudang
              </h2>
              <p className="auth-subtitle" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-3)' }}>
                Verifikasi keamanan menggunakan NIM dan PIN 6–8 digit.
              </p>
            </div>

            <form className="auth-form" onSubmit={handleLogin} noValidate>
              {/* Field NIM */}
              <div className="form-group">
                <label className="form-label" htmlFor={loginNimId}>
                  Nomor Induk Mahasiswa (NIM) <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={loginNimId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 02601011"
                    value={loginForm.nim}
                    onChange={(e) => setLoginForm((prev) => ({ ...prev, nim: e.target.value }))}
                    autoComplete="username"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              {/* Field PIN */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                  <label className="form-label" htmlFor={loginPinId} style={{ margin: 0 }}>
                    PIN Keamanan <span className="required" aria-hidden="true">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('setup');
                      setSetupForm((prev) => ({ ...prev, nim: loginForm.nim }));
                      setErrorMsg(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '0.72rem',
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Lupa / Belum Ada PIN?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <KeyRound
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={loginPinId}
                    type={showPin ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Masukkan 6–8 digit angka"
                    value={loginForm.pin}
                    onChange={(e) => setLoginForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))}
                    maxLength={8}
                    inputMode="numeric"
                    autoComplete="current-password"
                    required
                    disabled={isLoading}
                    style={{
                      paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                      paddingRight: 'calc(var(--space-3) + 20px + var(--space-2))',
                      letterSpacing: showPin ? 'normal' : '0.2em',
                      fontFamily: showPin ? 'inherit' : 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    style={{
                      position: 'absolute',
                      right: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                  Demi keamanan inventaris, salah 5x akan mengunci akses selama 15 menit.
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className={`btn btn-primary btn-full btn-lg ${isLoading ? 'btn-loading' : ''}`}
                disabled={isLoading}
                aria-busy={isLoading}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {!isLoading ? (
                  <>
                    <span>Masuk ke Portal Gudang</span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </>
                ) : (
                  <Loader2 size={18} className="spin-icon" />
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ── MODE 2: SETUP PIN MANDIRI ── */
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 className="auth-title" style={{ fontSize: '1.25rem' }}>
                Buat PIN Mandiri
              </h2>
              <p className="auth-subtitle" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-3)' }}>
                Verifikasi 3 lapis (Nama, NIM, &amp; Prodi) untuk aktivasi PIN gudang Anda.
              </p>
            </div>

            <form className="auth-form" onSubmit={handleSetupPin} noValidate>
              {/* Field Nama Asli */}
              <div className="form-group">
                <label className="form-label" htmlFor={setupNameId}>
                  Nama Lengkap Asli <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <User
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={setupNameId}
                    type="text"
                    className="form-input"
                    placeholder="Nama sesuai jadwal resmi"
                    value={setupForm.fullName}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, fullName: e.target.value }))}
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              {/* Field NIM */}
              <div className="form-group">
                <label className="form-label" htmlFor={setupNimId}>
                  Nomor Induk Mahasiswa (NIM) <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={setupNimId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 02601011"
                    value={setupForm.nim}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, nim: e.target.value }))}
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              {/* Field Program Studi */}
              <div className="form-group">
                <label className="form-label" htmlFor={setupProdiId}>
                  Program Studi <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <GraduationCap
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={setupProdiId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Manajemen / Teknik Informatika"
                    value={setupForm.programStudi}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, programStudi: e.target.value }))}
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              {/* Field PIN Baru */}
              <div className="form-group">
                <label className="form-label" htmlFor={setupPinId}>
                  Buat PIN Baru (6–8 Angka) <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <KeyRound
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={setupPinId}
                    type={showPin ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Minimal 6 angka rahasia"
                    value={setupForm.pin}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))}
                    maxLength={8}
                    inputMode="numeric"
                    required
                    disabled={isLoading}
                    style={{
                      paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                      paddingRight: 'calc(var(--space-3) + 20px + var(--space-2))',
                      letterSpacing: showPin ? 'normal' : '0.2em',
                      fontFamily: showPin ? 'inherit' : 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    style={{
                      position: 'absolute',
                      right: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Field Konfirmasi PIN */}
              <div className="form-group">
                <label className="form-label" htmlFor={setupConfirmPinId}>
                  Ulangi PIN Baru <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <KeyRound
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={setupConfirmPinId}
                    type={showConfirmPin ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Ketik ulang PIN yang sama"
                    value={setupForm.confirmPin}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, confirmPin: e.target.value.replace(/\D/g, '') }))}
                    maxLength={8}
                    inputMode="numeric"
                    required
                    disabled={isLoading}
                    style={{
                      paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))',
                      paddingRight: 'calc(var(--space-3) + 20px + var(--space-2))',
                      letterSpacing: showConfirmPin ? 'normal' : '0.2em',
                      fontFamily: showConfirmPin ? 'inherit' : 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPin(!showConfirmPin)}
                    aria-label={showConfirmPin ? 'Sembunyikan konfirmasi PIN' : 'Tampilkan konfirmasi PIN'}
                    style={{
                      position: 'absolute',
                      right: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {showConfirmPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit Setup Button */}
              <button
                type="submit"
                className={`btn btn-primary btn-full btn-lg ${isLoading ? 'btn-loading' : ''}`}
                disabled={isLoading}
                aria-busy={isLoading}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {!isLoading ? (
                  <>
                    <ShieldCheck size={18} aria-hidden="true" />
                    <span>Simpan &amp; Aktifkan PIN</span>
                  </>
                ) : (
                  <Loader2 size={18} className="spin-icon" />
                )}
              </button>
            </form>
          </div>
        )}

        {/* Footer Navigation */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 'var(--text-xs)',
          }}
        >
          <Link
            href="/kasir/login"
            style={{
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              fontWeight: 'var(--weight-semibold)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ArrowLeft size={13} />
            <span>Kiosk Kasir (POS)</span>
          </Link>

          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>
            v3.0 Zero-Trust Gudang
          </span>
        </div>
      </main>
    </div>
  );
}
