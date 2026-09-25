'use client';

import { useState, useId } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { LogIn, AlertCircle, User, Hash, GraduationCap } from 'lucide-react';

export default function KasirLoginPage() {
  const router = useRouter();
  const nameId = useId();
  const nimId = useId();
  const prodiId = useId();

  const [form, setForm] = useState({ fullName: '', nim: '', programStudi: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (error) setError(null);
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const { fullName, nim, programStudi } = form;
    if (!fullName.trim() || !nim.trim() || !programStudi.trim()) {
      setError('Semua kolom wajib diisi: Nama Lengkap, NIM, dan Program Studi.');
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

      // API response format: { success, data?, error?: string, code?: string }
      const json = await res.json() as {
        success: boolean;
        data?: { redirect?: string; name?: string; shiftId?: string };
        error?: string;
        code?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        // Tampilkan pesan dari server langsung (bukan fallback generik)
        setError(
          json.error ?? 'Data tidak ditemukan. Periksa kembali Nama, NIM, dan Program Studi Anda.'
        );
        return;
      }

      router.push(json.data.redirect ?? '/kasir/pos');
      router.refresh();
    } catch {
      setError('Koneksi gagal. Periksa jaringan internet Anda.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <main className="auth-card" role="main">
        {/* Logo */}
        <div className="auth-logo">
          <div style={{ width: 72, height: 72, position: 'relative' }}>
            <Image
              src="/logo.png"
              alt="Logo Smartkasir Perwira"
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div>
            <div className="auth-logo-name">SMARTKASIR PERWIRA</div>
            <div className="auth-logo-sub">Sistem Kasir Digital UNPERBA</div>
          </div>
        </div>

        {/* Heading */}
        <h1 className="auth-title">Login Karyawan Kasir</h1>
        <p className="auth-subtitle">
          Masukkan Nama Lengkap, NIM, dan Program Studi sesuai data yang terdaftar.
        </p>

        {/* Info badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--color-primary-light)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-5)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-primary)',
            fontWeight: 'var(--weight-medium)',
          }}
          role="note"
        >
          <GraduationCap size={16} aria-hidden="true" />
          <span>Sesi kerja Anda akan otomatis tercatat saat login dan logout.</span>
        </div>

        {/* Error alert */}
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

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {/* Nama Lengkap */}
          <div className="form-group">
            <label className="form-label" htmlFor={nameId}>
              Nama Lengkap <span className="required" aria-hidden="true">*</span>
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
                id={nameId}
                type="text"
                className="form-input"
                placeholder="Contoh: Budi Santoso"
                value={form.fullName}
                onChange={handleChange('fullName')}
                autoComplete="name"
                autoCapitalize="words"
                required
                aria-required="true"
                disabled={isLoading}
                style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
              />
            </div>
          </div>

          {/* NIM */}
          <div className="form-group">
            <label className="form-label" htmlFor={nimId}>
              NIM <span className="required" aria-hidden="true">*</span>
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
                id={nimId}
                type="text"
                className="form-input"
                placeholder="Contoh: 220101001"
                value={form.nim}
                onChange={handleChange('nim')}
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                required
                aria-required="true"
                disabled={isLoading}
                style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          {/* Program Studi */}
          <div className="form-group">
            <label className="form-label" htmlFor={prodiId}>
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
                id={prodiId}
                type="text"
                className="form-input"
                placeholder="Contoh: Manajemen"
                value={form.programStudi}
                onChange={handleChange('programStudi')}
                autoComplete="off"
                required
                aria-required="true"
                disabled={isLoading}
                style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className={`btn btn-primary btn-full btn-lg ${isLoading ? 'btn-loading' : ''}`}
            disabled={isLoading}
            aria-busy={isLoading}
            style={{ marginTop: 'var(--space-2)' }}
          >
            {!isLoading && (
              <>
                <LogIn size={20} aria-hidden="true" />
                Mulai Sesi Kerja
              </>
            )}
          </button>
        </form>

        {/* Back to admin login */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center',
          }}
        >
          <a
            href="/login"
            className="text-sm text-muted"
            style={{
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              fontWeight: 'var(--weight-medium)',
              transition: 'color var(--duration-fast)',
            }}
          >
            ← Login sebagai Admin
          </a>
        </div>
      </main>
    </div>
  );
}
