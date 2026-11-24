import type { Metadata } from 'next';
import NotaBelanjaPanel from '@/features/portal/nota-belanja/NotaBelanjaPanel';

export const metadata: Metadata = {
  title: 'Arsip Nota Belanja',
};

export default function ManagerNotaBelanjaPage() {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: 'clamp(1.15rem, 3.5vw, 1.45rem)', fontWeight: 800 }}>
          Nota Belanja &amp; Operasional
        </h1>
        <p className="page-subtitle" style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          Akses Penuh Manager · Audit bukti nota belanja, reseller, operasional, dan buku historis
        </p>
      </div>
      <NotaBelanjaPanel portalRole="MANAGER" />
    </div>
  );
}
