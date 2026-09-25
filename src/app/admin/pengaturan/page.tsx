'use client';

import { useState, useEffect, useId, useRef } from 'react';
import {
  Settings,
  Wrench,
  QrCode,
  Loader2,
  Upload,
  CheckCircle,
  AlertCircle,
  Power,
  X,
  Eye,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type FeedbackStatus = 'idle' | 'loading' | 'success' | 'error';

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function PengaturanPage() {
  const uid = useId();
  const qrFileInputRef = useRef<HTMLInputElement>(null);

  // ── Maintenance state ──────────────────────────────────────
  const [maintenanceOn, setMaintenanceOn] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [maintenanceStatus, setMaintenanceStatus] = useState<FeedbackStatus>('idle');

  // ── QRIS state ─────────────────────────────────────────────
  const [qrisBank, setQrisBank] = useState('');
  const [qrisName, setQrisName] = useState('');
  const [qrisActive, setQrisActive] = useState(false);
  const [qrisFile, setQrisFile] = useState<File | null>(null);
  const [qrisPreview, setQrisPreview] = useState<string | null>(null);
  const [qrisCurrentUrl, setQrisCurrentUrl] = useState<string | null>(null);
  const [qrisStatus, setQrisStatus] = useState<FeedbackStatus>('idle');

  // ── Fetch initial state ────────────────────────────────────
  useEffect(() => {
    // Fix Bug 1: URL yang benar adalah /api/maintenance/status (bukan /api/maintenance/route)
    fetch('/api/maintenance/status')
      .then((r) => r.json())
      .then((json: { isMaintenance?: boolean; message?: string }) => {
        if (typeof json.isMaintenance === 'boolean') {
          setMaintenanceOn(json.isMaintenance);
          setMaintenanceMsg(json.message ?? '');
        }
      })
      .catch(() => {
        // Gagal fetch — biarkan default (false)
      });

    // Fetch QRIS settings yang sudah tersimpan
    fetch('/api/admin/pengaturan/qris')
      .then((r) => r.json())
      .then((json: { success?: boolean; data?: { bankName?: string; accountName?: string; isActive?: boolean; qrImageUrl?: string | null } }) => {
        if (json.success && json.data) {
          setQrisBank(json.data.bankName ?? '');
          setQrisName(json.data.accountName ?? '');
          setQrisActive(json.data.isActive ?? false);
          setQrisCurrentUrl(json.data.qrImageUrl ?? null);
        }
      })
      .catch(() => {
        // Belum ada data QRIS — biarkan form kosong
      });
  }, []);

  // ── Handle QR file select ──────────────────────────────────
  function handleQrisFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setQrisFile(file);

    // Buat preview lokal
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setQrisPreview(objectUrl);
    } else {
      setQrisPreview(null);
    }
  }

  function removeQrisFile() {
    setQrisFile(null);
    setQrisPreview(null);
    if (qrFileInputRef.current) qrFileInputRef.current.value = '';
  }

  // ── Save maintenance ───────────────────────────────────────
  async function saveMaintenance() {
    setMaintenanceStatus('loading');
    try {
      // Fix Bug 1: POST ke endpoint yang benar /api/maintenance/status
      const res = await fetch('/api/maintenance/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isMaintenance: maintenanceOn,
          message: maintenanceMsg || undefined,
        }),
      });
      setMaintenanceStatus(res.ok ? 'success' : 'error');
    } catch {
      setMaintenanceStatus('error');
    } finally {
      setTimeout(() => setMaintenanceStatus('idle'), 3000);
    }
  }

  // ── Save QRIS ─────────────────────────────────────────────
  async function saveQris() {
    setQrisStatus('loading');
    try {
      // Gunakan FormData agar bisa kirim file + teks sekaligus
      const formData = new FormData();
      formData.append('bankName', qrisBank);
      formData.append('accountName', qrisName);
      formData.append('isActive', String(qrisActive));
      if (qrisFile) {
        formData.append('qrImage', qrisFile);
      }

      const res = await fetch('/api/admin/pengaturan/qris', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const json = await res.json() as { success?: boolean; data?: { qrImageUrl?: string | null } };
        if (json.success && json.data?.qrImageUrl) {
          setQrisCurrentUrl(json.data.qrImageUrl);
        }
        setQrisStatus('success');
        setQrisFile(null);
        setQrisPreview(null);
        if (qrFileInputRef.current) qrFileInputRef.current.value = '';
      } else {
        setQrisStatus('error');
      }
    } catch {
      setQrisStatus('error');
    } finally {
      setTimeout(() => setQrisStatus('idle'), 3000);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengaturan Sistem</h1>
          <p className="page-subtitle">Konfigurasi maintenance mode dan QRIS pembayaran</p>
        </div>
        <Settings size={20} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-5)',
        }}
      >
        {/* ── Maintenance Mode ───────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h2
              className="card-title"
              style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Wrench size={16} aria-hidden="true" />
              Maintenance Mode
            </h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Toggle row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: maintenanceOn ? 'var(--color-warning-light)' : 'var(--color-surface-alt)',
                transition: 'background-color var(--duration-base) var(--ease-out-expo)',
              }}
            >
              <div>
                <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                  {maintenanceOn ? 'Sistem Dalam Maintenance' : 'Sistem Normal'}
                </div>
                <div style={{ color: 'var(--color-text-muted)', marginTop: 2, fontSize: 'var(--text-xs)' }}>
                  {maintenanceOn ? 'Karyawan tidak bisa login' : 'Semua pengguna bisa login'}
                </div>
              </div>

              {/* Toggle switch — accessible */}
              <button
                id={`${uid}-toggle-maintenance`}
                role="switch"
                aria-checked={maintenanceOn}
                aria-label={`${maintenanceOn ? 'Matikan' : 'Aktifkan'} maintenance mode`}
                onClick={() => setMaintenanceOn((v) => !v)}
                style={{
                  width: 52,
                  height: 28,
                  borderRadius: 14,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: maintenanceOn ? 'var(--color-warning)' : 'var(--color-border)',
                  position: 'relative',
                  transition: 'background-color var(--duration-base) var(--ease-spring)',
                  flexShrink: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: maintenanceOn ? 26 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    transition: 'left var(--duration-base) var(--ease-spring)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>

            {/* Pesan maintenance */}
            <div className="form-group">
              <label htmlFor={`${uid}-maint-msg`} className="form-label">
                Pesan untuk Pengguna
              </label>
              <textarea
                id={`${uid}-maint-msg`}
                className="form-input form-textarea"
                rows={3}
                placeholder="Sistem sedang dalam pemeliharaan. Mohon tunggu..."
                value={maintenanceMsg}
                onChange={(e) => setMaintenanceMsg(e.target.value)}
                maxLength={500}
              />
            </div>

            <button
              id={`${uid}-save-maintenance`}
              onClick={saveMaintenance}
              className="btn btn-primary"
              disabled={maintenanceStatus === 'loading'}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'center' }}
            >
              {maintenanceStatus === 'loading' ? (
                <>
                  <Loader2 size={14} className="spin-icon" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : maintenanceStatus === 'success' ? (
                <>
                  <CheckCircle size={14} aria-hidden="true" />
                  Tersimpan!
                </>
              ) : maintenanceStatus === 'error' ? (
                <>
                  <AlertCircle size={14} aria-hidden="true" />
                  Gagal — Coba lagi
                </>
              ) : (
                <>
                  <Power size={14} aria-hidden="true" />
                  Simpan Pengaturan
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── QRIS Settings ────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h2
              className="card-title"
              style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <QrCode size={16} aria-hidden="true" />
              Pengaturan QRIS
            </h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Info banner */}
            <div
              style={{
                backgroundColor: 'var(--color-info-light)',
                color: 'var(--color-info)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                padding: 'var(--space-3)',
                lineHeight: 1.5,
              }}
            >
              Upload gambar QR Code statis dari rekening bank. Kasir akan menampilkan QR ini saat
              pembayaran QRIS.
            </div>

            {/* Nama Bank */}
            <div className="form-group">
              <label htmlFor={`${uid}-bank`} className="form-label">
                Nama Bank
              </label>
              <input
                id={`${uid}-bank`}
                type="text"
                className="form-input"
                placeholder="Contoh: BRI / Mandiri / BSI"
                value={qrisBank}
                onChange={(e) => setQrisBank(e.target.value)}
                autoComplete="off"
              />
            </div>

            {/* Nama Pemilik Rekening */}
            <div className="form-group">
              <label htmlFor={`${uid}-qname`} className="form-label">
                Nama Pemilik Rekening
              </label>
              <input
                id={`${uid}-qname`}
                type="text"
                className="form-input"
                placeholder="Nama sesuai rekening"
                value={qrisName}
                onChange={(e) => setQrisName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {/* Upload QR Image */}
            <div className="form-group">
              <label className="form-label">Gambar QR Code</label>

              {/* Preview area — tampil jika ada preview baru atau URL tersimpan */}
              {(qrisPreview ?? qrisCurrentUrl) && (
                <div
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrisPreview ?? qrisCurrentUrl!}
                    alt="Preview QR Code"
                    style={{
                      width: 140,
                      height: 140,
                      objectFit: 'contain',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'white',
                      display: 'block',
                    }}
                  />
                  {/* Tombol lihat */}
                  <a
                    href={qrisPreview ?? qrisCurrentUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Lihat QR full size"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      color: 'white',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 6px',
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      textDecoration: 'none',
                    }}
                  >
                    <Eye size={11} aria-hidden="true" />
                    Lihat
                  </a>
                  {/* Tombol hapus file baru saja dipilih */}
                  {qrisPreview && (
                    <button
                      type="button"
                      onClick={removeQrisFile}
                      aria-label="Batal upload gambar baru"
                      style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-error)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {/* Drop zone */}
              <label
                htmlFor={`${uid}-qr-upload`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-5)',
                  border: `2px dashed ${qrisFile ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-sm)',
                  transition: 'border-color var(--duration-fast) var(--ease-out-expo)',
                  backgroundColor: qrisFile ? 'var(--color-primary-surface)' : 'transparent',
                }}
              >
                <Upload size={22} aria-hidden="true" />
                <span style={{ fontWeight: 'var(--weight-medium)' }}>
                  {qrisFile ? qrisFile.name : 'Klik untuk upload gambar QR'}
                </span>
                <span style={{ fontSize: 'var(--text-xs)' }}>PNG, JPG — Maks 2MB</span>
              </label>
              <input
                ref={qrFileInputRef}
                id={`${uid}-qr-upload`}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                style={{ display: 'none' }}
                aria-label="Upload gambar QR Code"
                onChange={handleQrisFileChange}
              />
            </div>

            {/* Aktifkan QRIS toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) 0',
              }}
            >
              <label
                htmlFor={`${uid}-qris-active`}
                className="form-label"
                style={{ margin: 0, cursor: 'pointer' }}
              >
                Aktifkan QRIS sebagai metode pembayaran
              </label>
              <input
                id={`${uid}-qris-active`}
                type="checkbox"
                checked={qrisActive}
                onChange={(e) => setQrisActive(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
              />
            </div>

            <button
              id={`${uid}-save-qris`}
              onClick={saveQris}
              className="btn btn-primary"
              disabled={qrisStatus === 'loading'}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'center' }}
            >
              {qrisStatus === 'loading' ? (
                <>
                  <Loader2 size={14} className="spin-icon" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : qrisStatus === 'success' ? (
                <>
                  <CheckCircle size={14} aria-hidden="true" />
                  Tersimpan!
                </>
              ) : qrisStatus === 'error' ? (
                <>
                  <AlertCircle size={14} aria-hidden="true" />
                  Gagal — Coba lagi
                </>
              ) : (
                <>
                  <QrCode size={14} aria-hidden="true" />
                  Simpan QRIS
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
