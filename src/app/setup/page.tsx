'use client';
// =============================================================
// /setup — Install Wizard: Setup Admin Pertama (Bu Dyah, dll)
// Hanya bisa diakses saat database admins masih kosong
// Setelah admin pertama dibuat → halaman ini dikunci selamanya
// =============================================================

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, AlertCircle, Loader2, Lock, ShieldCheck } from 'lucide-react';

type SetupStatus = 'checking' | 'available' | 'locked' | 'done';

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus>('checking');
  const [nidn, setNidn]         = useState('');
  const [nama, setNama]         = useState('');
  const [password, setPassword] = useState('');
  const [konfirm, setKonfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [successName, setSuccessName] = useState('');

  // Cek ketersediaan setup
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then((j: { success: boolean; data?: { setupAvailable: boolean } }) => {
        if (j.success && j.data?.setupAvailable) setStatus('available');
        else setStatus('locked');
      })
      .catch(() => setStatus('locked'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== konfirm) { setError('Konfirmasi password tidak cocok.'); return; }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nidn, fullName: nama, password, confirmPass: konfirm }),
      });
      const json = await res.json() as { success: boolean; data?: { message: string }; error?: string };
      if (json.success) {
        setSuccessName(nama);
        setStatus('done');
        setTimeout(() => router.push('/login'), 3500);
      } else {
        setError(json.error ?? 'Gagal membuat akun.');
      }
    } catch {
      setError('Kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', padding: 'var(--space-5)',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div style={{ fontSize: 36, marginBottom: 'var(--space-3)' }}>🏪</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', marginBottom: 'var(--space-1)' }}>
            SmartKasir Perwira
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Setup Awal Sistem
          </p>
        </div>

        <div className="card">
          <div className="card-body">

            {/* ── Checking ── */}
            {status === 'checking' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                <Loader2 size={18} className="spin-icon" />
                Memeriksa status sistem...
              </div>
            )}

            {/* ── Locked (sudah ada admin) ── */}
            {status === 'locked' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-6)', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Lock size={28} style={{ color: 'var(--color-text-muted)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)', color: 'var(--color-text)' }}>
                    Setup Sudah Selesai
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    Sistem sudah memiliki admin aktif.<br />
                    Halaman ini dikunci secara otomatis.
                  </div>
                </div>
                <a href="/login" className="btn btn-primary" style={{ marginTop: 'var(--space-2)' }}>
                  Ke Halaman Login →
                </a>
              </div>
            )}

            {/* ── Available: Form setup ── */}
            {status === 'available' && (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                {/* Banner info */}
                <div style={{ padding: 'var(--space-4)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <ShieldCheck size={20} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', lineHeight: 1.5 }}>
                    <strong>Selamat datang!</strong> Belum ada admin di sistem ini.<br />
                    Buat akun admin pertama untuk mulai menggunakan SmartKasir.
                    Setelah ini, halaman setup akan terkunci otomatis.
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">NIDN / NIDK <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="form-input"
                    placeholder="Contoh: 0412345678"
                    value={nidn}
                    onChange={e => setNidn(e.target.value)}
                    required
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
                  />
                  <p className="form-hint">Nomor Induk Dosen Nasional atau Nomor Induk Dosen Khusus.</p>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Lengkap <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="form-input"
                    placeholder="Nama sesuai dokumen resmi"
                    value={nama}
                    onChange={e => setNama(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Buat Password <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Minimal 6 karakter"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Konfirmasi Password <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Ulangi password"
                    value={konfirm}
                    onChange={e => setKonfirm(e.target.value)}
                    required
                  />
                </div>

                {error && (
                  <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={loading || !nidn || !nama || !password || !konfirm}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 'var(--space-2)' }}
                >
                  {loading
                    ? <><Loader2 size={16} className="spin-icon" /> Membuat Akun...</>
                    : <><ShieldCheck size={16} /> Buat Akun Admin Pertama</>
                  }
                </button>
              </form>
            )}

            {/* ── Done ── */}
            {status === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)', padding: 'var(--space-6)', textAlign: 'center' }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: 'var(--color-success-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'check-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                  <CheckCircle size={40} style={{ color: 'var(--color-success)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                    Selamat, {successName}!
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    Akun admin berhasil dibuat.<br />
                    Mengalihkan ke halaman login...
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  <Loader2 size={12} className="spin-icon" /> Redirect otomatis dalam 3 detik...
                </div>
              </div>
            )}

          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Sudah punya akun?{' '}
          <a href="/login" style={{ color: 'var(--color-primary)' }}>Login di sini</a>
        </p>
      </div>
    </div>
  );
}
