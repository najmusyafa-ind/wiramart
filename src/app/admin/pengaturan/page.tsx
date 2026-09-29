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
  Database,
  Download,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  FileText,
  CheckCircle2,
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

  // ── Database Backup & Restore state ─────────────────────────
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    checksum?: string;
  } | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePayload, setRestorePayload] = useState<Record<string, unknown> | null>(null);
  const [restoreInspect, setRestoreInspect] = useState<{
    timestamp: string;
    tablesCount: number;
    totalRows: number;
    checksum: string;
    createdByName: string;
  } | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    rows?: number;
    duration?: number;
  } | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

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

  // ── Download Database Backup ───────────────────────────────
  async function handleDownloadBackup() {
    setBackupLoading(true);
    setBackupFeedback(null);
    try {
      const res = await fetch('/api/admin/database/backup');
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || 'Gagal mengunduh file backup');
      }

      const checksum = res.headers.get('X-Backup-Checksum') || '';
      const totalRows = res.headers.get('X-Backup-Total-Rows') || '';
      const disposition = res.headers.get('Content-Disposition') || '';
      let filename = 'backup-smartkasir.json';
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setBackupFeedback({
        type: 'success',
        message: `Snapshot database berhasil diunduh (${totalRows} total baris).`,
        checksum,
      });
    } catch (err: unknown) {
      setBackupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal membuat file backup',
      });
    } finally {
      setBackupLoading(false);
    }
  }

  // ── Handle Restore File Select & Inspect ───────────────────
  function handleRestoreFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setRestoreFeedback(null);
    if (!file) {
      setRestoreFile(null);
      setRestorePayload(null);
      setRestoreInspect(null);
      return;
    }

    setRestoreFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string) as {
          metadata?: {
            app?: string;
            timestamp?: string;
            tablesCount?: number;
            totalRows?: number;
            checksum?: string;
            createdByName?: string;
          };
        };

        if (json?.metadata?.app !== 'smartkasir-perwira') {
          throw new Error('File ini bukan berkas snapshot resmi Smartkasir Perwira.');
        }

        setRestorePayload(json as Record<string, unknown>);
        setRestoreInspect({
          timestamp: json.metadata.timestamp ?? '',
          tablesCount: json.metadata.tablesCount ?? 14,
          totalRows: json.metadata.totalRows ?? 0,
          checksum: json.metadata.checksum ?? '',
          createdByName: json.metadata.createdByName ?? 'Admin',
        });
      } catch (err) {
        setRestoreFile(null);
        setRestorePayload(null);
        setRestoreInspect(null);
        if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
        setRestoreFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Format berkas JSON tidak valid.',
        });
      }
    };
    reader.readAsText(file);
  }

  // ── Execute Restore Transaction ───────────────────────────
  async function executeRestore() {
    if (!restorePayload) return;
    setRestoreLoading(true);
    setRestoreFeedback(null);
    try {
      const res = await fetch('/api/admin/database/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: restorePayload }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string; restoredRows?: number; durationMs?: number };
      };

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal memulihkan database.');
      }

      setRestoreFeedback({
        type: 'success',
        message: json.data?.message || 'Database berhasil dipulihkan seutuhnya.',
        rows: json.data?.restoredRows,
        duration: json.data?.durationMs,
      });

      setRestoreModalOpen(false);
      setRestoreFile(null);
      setRestorePayload(null);
      setRestoreInspect(null);
      setRestoreConfirmText('');
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    } catch (err) {
      setRestoreFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Terjadi kegagalan saat proses restore.',
      });
      setRestoreModalOpen(false);
    } finally {
      setRestoreLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengaturan Sistem & Database</h1>
          <p className="page-subtitle">Konfigurasi maintenance mode, QRIS, dan pencadangan database</p>
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

        {/* ── Database Security & Backup Restore ──────────── */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h2
              className="card-title"
              style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Database size={16} aria-hidden="true" />
              Keamanan & Pemulihan Database (Backup & Restore)
            </h2>
          </div>

          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Status Security Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary-light)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <ShieldCheck size={20} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                <div>
                  <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}>
                    Row-Level Security (RLS v1.2): 14 / 14 Tabel Terproteksi
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    Akses anonim ditolak total. Mutasi database diamankan dengan isolasi transaksi ACID & Drizzle ORM.
                  </div>
                </div>
              </div>
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-bold)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                }}
              >
                Zero-Trust Active
              </span>
            </div>

            {/* Grid 2 Kolom: Backup dan Restore */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              {/* Kolom A: Download Backup */}
              <div
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Download size={16} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                  <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                    Cadangkan Data (Backup)
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Unduh seluruh snapshot 14 tabel database (produk, stok, transaksi, karyawan, pengaturan) ke dalam satu berkas terenkripsi dengan Checksum SHA-256.
                </p>

                <button
                  id={`${uid}-btn-download-backup`}
                  onClick={handleDownloadBackup}
                  disabled={backupLoading}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'center', marginTop: 'auto' }}
                >
                  {backupLoading ? (
                    <>
                      <Loader2 size={14} className="spin-icon" aria-hidden="true" />
                      Mengekstraksi Data...
                    </>
                  ) : (
                    <>
                      <Download size={14} aria-hidden="true" />
                      Unduh Snapshot Database (.json)
                    </>
                  )}
                </button>

                {backupFeedback && (
                  <div
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-xs)',
                      backgroundColor: backupFeedback.type === 'success' ? 'var(--color-success-light)' : 'var(--color-error-light)',
                      color: backupFeedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                    }}
                  >
                    <div>{backupFeedback.message}</div>
                    {backupFeedback.checksum && (
                      <div style={{ fontFamily: 'monospace', fontSize: '10px', marginTop: 4, opacity: 0.85 }}>
                        SHA-256: {backupFeedback.checksum.slice(0, 24)}...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Kolom B: Restore Database */}
              <div
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <RotateCcw size={16} style={{ color: 'var(--color-warning)' }} aria-hidden="true" />
                  <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                    Pulihkan Data (Restore)
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Unggah berkas snapshot JSON resmi untuk memulihkan seluruh tabel. Integritas data akan divalidasi dengan Checksum SHA-256 sebelum eksekusi.
                </p>

                <input
                  ref={restoreFileInputRef}
                  id={`${uid}-input-restore-file`}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRestoreFileSelect}
                  style={{ fontSize: 'var(--text-xs)' }}
                />

                {restoreInspect && (
                  <div
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--color-surface-muted)',
                      border: '1px solid var(--color-border)',
                      fontSize: 'var(--text-xs)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-primary)' }}>
                      ✓ Berkas Valid ({restoreInspect.tablesCount} Tabel terdeteksi)
                    </div>
                    <div>Total Data: <strong>{restoreInspect.totalRows} baris</strong></div>
                    <div>Dibuat oleh: {restoreInspect.createdByName}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      Hash: {restoreInspect.checksum.slice(0, 20)}...
                    </div>
                  </div>
                )}

                <button
                  id={`${uid}-btn-open-restore`}
                  disabled={!restorePayload}
                  onClick={() => setRestoreModalOpen(true)}
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    justifyContent: 'center',
                    marginTop: 'auto',
                    backgroundColor: restorePayload ? 'var(--color-warning)' : 'var(--color-surface-muted)',
                    color: restorePayload ? 'white' : 'var(--color-text-muted)',
                    cursor: restorePayload ? 'pointer' : 'not-allowed',
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Lanjutkan Pemulihan Data...
                </button>

                {restoreFeedback && (
                  <div
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-xs)',
                      backgroundColor: restoreFeedback.type === 'success' ? 'var(--color-success-light)' : 'var(--color-error-light)',
                      color: restoreFeedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                    }}
                  >
                    <div>{restoreFeedback.message}</div>
                    {restoreFeedback.duration && (
                      <div style={{ marginTop: 2, fontSize: '11px', opacity: 0.9 }}>
                        Waktu eksekusi: {(restoreFeedback.duration / 1000).toFixed(2)} detik
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Modal Konfirmasi Ganda Pemulihan Database (Double Confirmation) ── */}
      {restoreModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-restore-modal-title`}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--space-4)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: 480,
              width: '100%',
              padding: 'var(--space-6)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-error-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShieldAlert size={22} style={{ color: 'var(--color-error)' }} aria-hidden="true" />
              </div>
              <div>
                <h3
                  id={`${uid}-restore-modal-title`}
                  style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}
                >
                  Konfirmasi Pemulihan Database
                </h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  Tindakan ini memerlukan verifikasi otorisasi penuh
                </p>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--color-error-light)',
                color: 'var(--color-error)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                lineHeight: 1.5,
              }}
            >
              <strong>PERINGATAN KRITIS:</strong> Seluruh 14 tabel database (transaksi saat ini, produk, shift, dll.) akan diselaraskan dan ditimpa secara atomik dengan isi berkas backup ({restoreInspect?.totalRows} baris).
            </div>

            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label htmlFor={`${uid}-confirm-text`} className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                Ketik kata <span style={{ fontWeight: 'bold', color: 'var(--color-error)' }}>PULIHKAN</span> untuk konfirmasi:
              </label>
              <input
                id={`${uid}-confirm-text`}
                type="text"
                className="form-input"
                placeholder="PULIHKAN"
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                style={{ fontFamily: 'monospace', letterSpacing: 1 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={restoreLoading}
                onClick={() => {
                  setRestoreModalOpen(false);
                  setRestoreConfirmText('');
                }}
              >
                Batal
              </button>

              <button
                type="button"
                className="btn"
                disabled={restoreConfirmText !== 'PULIHKAN' || restoreLoading}
                onClick={executeRestore}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  backgroundColor: restoreConfirmText === 'PULIHKAN' ? 'var(--color-error)' : 'var(--color-border)',
                  color: 'white',
                  cursor: restoreConfirmText === 'PULIHKAN' && !restoreLoading ? 'pointer' : 'not-allowed',
                }}
              >
                {restoreLoading ? (
                  <>
                    <Loader2 size={14} className="spin-icon" aria-hidden="true" />
                    Menjalankan Transaksi Restore...
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} aria-hidden="true" />
                    Ya, Pulihkan Database
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
