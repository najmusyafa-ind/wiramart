import type { Metadata } from 'next';
import NotaBelanjaPanel from '@/features/portal/nota-belanja/NotaBelanjaPanel';

export const metadata: Metadata = {
  title: 'Arsip Nota Belanja',
};

export default function AdminNotaBelanjaPage() {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: 'clamp(1.15rem, 3.5vw, 1.45rem)', fontWeight: 800 }}>
          Nota Belanja &amp; Operasional
        </h1>
        <p className="page-subtitle" style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          Portal Admin Shift · Unggah bukti nota harian dan lihat arsip foto &amp; keterangannya
        </p>
      </div>
      <NotaBelanjaPanel portalRole="ADMIN_SHIFT" />
    </div>
  );
}
