'use client';

import Link from 'next/link';
import {
  ShieldAlert,
  ArrowLeftRight,
  Clock,
  AlertTriangle,
  QrCode,
  Coins,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Download,
  Calendar,
  Users,
  Lightbulb,
  Package,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';

export type AutoClosedShiftInfo = {
  id: string;
  employeeName: string;
  clockIn: string;
  clockOut: string | null;
  notes: string | null;
};

export type ApprovalCenterProps = {
  pendingSwapsCount: number;
  pendingProposalsCount?: number;
  criticalBatchesCount?: number;
  autoClosedShiftsCount: number;
  autoClosedShifts: AutoClosedShiftInfo[];
  qrisNeedsAttention: boolean;
  qrisStatusText: string;
  pettyCashOut: number;
  pettyCashIn: number;
};

export default function ApprovalCenterWidget({
  pendingSwapsCount,
  pendingProposalsCount = 0,
  criticalBatchesCount = 0,
  autoClosedShiftsCount,
  autoClosedShifts,
  qrisNeedsAttention,
  qrisStatusText,
  pettyCashOut,
  pettyCashIn,
}: ApprovalCenterProps) {
  const totalAlerts =
    pendingSwapsCount +
    autoClosedShiftsCount +
    (qrisNeedsAttention ? 1 : 0) +
    pendingProposalsCount +
    (criticalBatchesCount > 0 ? 1 : 0);

  return (
    <div className="card" style={{ marginTop: 'var(--space-6)', overflow: 'hidden' }}>
      {/* Header Banner Control Center */}
      <div
        style={{
          padding: 'var(--space-4) var(--space-5)',
          backgroundColor:
            totalAlerts > 0
              ? 'hsl(38 92% 50% / 0.12)'
              : 'hsl(142 71% 45% / 0.12)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-full)',
              backgroundColor:
                totalAlerts > 0
                  ? 'hsl(38 92% 50%)'
                  : 'var(--color-success)',
              color: 'white',
            }}
          >
            {totalAlerts > 0 ? (
              <ShieldAlert size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )}
          </span>
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
              Pusat Kendali &amp; Persetujuan Dosen Pembina
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
              {totalAlerts > 0
                ? `Terdapat ${totalAlerts} hal yang memerlukan tinjauan / tindakan Anda.`
                : 'Semua shift, absensi, dan rekonsiliasi kasir berjalan tertib.'}
            </p>
          </div>
        </div>

        {/* Quick Links Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link
            href="/admin/export"
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem' }}
          >
            <Download size={13} /> Ekspor Excel 1-Sheet
          </Link>
          <Link
            href="/admin/jadwal"
            className="btn btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem' }}
          >
            <Calendar size={13} /> Jadwal
          </Link>
        </div>
      </div>

      {/* Grid Status Kendali */}
      <div
        style={{
          padding: 'var(--space-5)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {/* 1. Pengajuan Tukar Shift */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${
              pendingSwapsCount > 0 ? 'hsl(38 92% 50% / 0.4)' : 'var(--color-border)'
            }`,
            backgroundColor:
              pendingSwapsCount > 0 ? 'hsl(38 92% 50% / 0.05)' : 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: pendingSwapsCount > 0 ? 'hsl(38 92% 40%)' : 'inherit',
                }}
              >
                <ArrowLeftRight size={16} />
                Persetujuan Tukar Shift
              </span>
              <span
                className={`badge ${
                  pendingSwapsCount > 0 ? 'badge-warning' : 'badge-success'
                }`}
                style={{ fontSize: '0.72rem' }}
              >
                {pendingSwapsCount > 0 ? `${pendingSwapsCount} Menunggu` : 'Nihil'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
              {pendingSwapsCount > 0
                ? 'Ada permohonan pertukaran shift mahasiswa yang menunggu persetujuan Dosen.'
                : 'Tidak ada permohonan tukar shift yang tertunda.'}
            </p>
          </div>

          <Link
            href="/admin/swap-request"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
          >
            Buka Riwayat &amp; Setujui <ChevronRight size={14} />
          </Link>
        </div>

        {/* 2. Rekonsiliasi Bank QRIS */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${
              qrisNeedsAttention ? 'var(--color-error)' : 'var(--color-border)'
            }`,
            backgroundColor: qrisNeedsAttention
              ? 'hsl(0 84% 60% / 0.05)'
              : 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: qrisNeedsAttention ? 'var(--color-error)' : 'inherit',
                }}
              >
                <QrCode size={16} />
                Rekonsiliasi Bank QRIS
              </span>
              <span
                className={`badge ${
                  qrisNeedsAttention ? 'badge-error' : 'badge-success'
                }`}
                style={{ fontSize: '0.72rem' }}
              >
                {qrisStatusText}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
              {qrisNeedsAttention
                ? 'Mutasi kredit bank Mandiri / Livin&apos; belum sinkron atau ada nota yang perlu diaudit.'
                : 'Seluruh transaksi QRIS bulan ini telah dicocokkan dengan mutasi rekening.'}
            </p>
          </div>

          <Link
            href="/admin/qris"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
          >
            Buka Tabel Rekonsiliasi <ChevronRight size={14} />
          </Link>
        </div>

        {/* 3. Kas Gerak & Petty Cash Hari Ini */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem' }}>
                <Coins size={16} />
                Petty Cash Laci Hari Ini
              </span>
              <span
                className="badge badge-info"
                style={{ fontSize: '0.72rem' }}
              >
                Audit Kas
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', margin: '6px 0' }}>
              <span style={{ color: 'var(--color-error)' }}>
                Kas Keluar: <strong>{formatRupiah(pettyCashOut)}</strong>
              </span>
              <span style={{ color: 'var(--color-success)' }}>
                Kas Masuk: <strong>{formatRupiah(pettyCashIn)}</strong>
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '4px 0 var(--space-3)' }}>
              Pengeluaran darurat seperti galon, bensin, atau kresek dicatat kasir di POS.
            </p>
          </div>

          <Link
            href="/admin/laporan"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
          >
            Rincian di Laporan Harian <ChevronRight size={14} />
          </Link>
        </div>

        {/* 4. Usulan Produk Baru dari Kasir (K8) */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${
              pendingProposalsCount > 0 ? 'hsl(217 91% 60% / 0.5)' : 'var(--color-border)'
            }`,
            backgroundColor:
              pendingProposalsCount > 0 ? 'hsl(217 91% 60% / 0.05)' : 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: pendingProposalsCount > 0 ? 'hsl(217 91% 50%)' : 'inherit',
                }}
              >
                <Lightbulb size={16} />
                Usulan Produk Kasir
              </span>
              <span
                className={`badge ${
                  pendingProposalsCount > 0 ? 'badge-primary' : 'badge-secondary'
                }`}
                style={{ fontSize: '0.72rem' }}
              >
                {pendingProposalsCount > 0 ? `${pendingProposalsCount} Menunggu` : 'Nihil'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
              {pendingProposalsCount > 0
                ? 'Terdapat usulan produk baru dari kasir yang memerlukan review HPP & margin toko.'
                : 'Belum ada usulan produk baru yang menunggu peninjauan.'}
            </p>
          </div>

          <Link
            href="/admin/produk"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
          >
            Review Usulan Produk <ChevronRight size={14} />
          </Link>
        </div>

        {/* 5. Alert Kedaluwarsa Gudang FEFO (F3) */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${
              criticalBatchesCount > 0 ? 'var(--color-error)' : 'var(--color-border)'
            }`,
            backgroundColor:
              criticalBatchesCount > 0 ? 'hsl(0 84% 60% / 0.05)' : 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: criticalBatchesCount > 0 ? 'var(--color-error)' : 'inherit',
                }}
              >
                <Package size={16} />
                Kedaluwarsa Stok (FEFO)
              </span>
              <span
                className={`badge ${
                  criticalBatchesCount > 0 ? 'badge-error' : 'badge-success'
                }`}
                style={{ fontSize: '0.72rem' }}
              >
                {criticalBatchesCount > 0 ? `${criticalBatchesCount} Kritis` : 'Aman'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
              {criticalBatchesCount > 0
                ? 'Ada batch stok yang telah kedaluwarsa atau mendekati jatuh tempo (≤ 7 hari).'
                : 'Seluruh batch stok produk masih dalam batas aman kedaluwarsa.'}
            </p>
          </div>

          <Link
            href="/admin/produk"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
          >
            Pantau Batch Kedaluwarsa <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* Warning Box jika ada Shift yang Ditutup Paksa oleh Cron */}
      {autoClosedShiftsCount > 0 && (
        <div
          style={{
            margin: '0 var(--space-5) var(--space-5)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'hsl(0 84% 60% / 0.08)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-error)', fontWeight: 600, fontSize: '0.85rem' }}>
            <AlertTriangle size={16} />
            Perhatian: {autoClosedShiftsCount} Shift Ditutup Otomatis oleh Sistem (Auto-Closed)
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '4px 0 8px' }}>
            Kasir lupa tutup shift sehingga ditutup otomatis oleh Cron tengah malam. Fisik uang laci belum dihitung oleh kasir secara mandiri. Segera verifikasi fisik uang laci:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {autoClosedShifts.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.78rem',
                  padding: '4px 8px',
                  backgroundColor: 'white',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>
                  <strong>{s.employeeName}</strong> &bull; Masuk: {new Date(s.clockIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                </span>
                <span style={{ color: 'var(--color-error)', fontSize: '0.72rem', fontStyle: 'italic' }}>
                  Auto-closed oleh Cron
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
