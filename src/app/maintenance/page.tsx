import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sistem Sedang Dalam Pemeliharaan',
};

export default async function MaintenancePage() {
  // Fetch maintenance message from API
  let message = 'Sistem sedang dalam pemeliharaan. Mohon tunggu dan coba beberapa saat lagi.';
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/maintenance/status`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const data = await res.json() as { message?: string };
      if (data.message) message = data.message;
    }
  } catch {
    // use default message
  }

  return (
    <div className="maintenance-wrapper">
      <div className="maintenance-card">
        {/* Animated icon */}
        <div className="maintenance-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>

        {/* Logo */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--weight-extrabold)',
              color: 'var(--color-primary)',
              letterSpacing: 'var(--tracking-tight)',
              lineHeight: 'var(--leading-tight)',
            }}
          >
            SMARTKASIR PERWIRA
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
            Sistem Kasir Digital UNPERBA
          </div>
        </div>

        {/* Message */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text)',
              letterSpacing: 'var(--tracking-tight)',
              marginBottom: 'var(--space-3)',
            }}
          >
            Sedang Dalam Pemeliharaan
          </h1>
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-secondary)',
              lineHeight: 'var(--leading-relaxed)',
              maxWidth: '360px',
            }}
          >
            {message}
          </p>
        </div>

        {/* Status indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-5)',
            backgroundColor: 'var(--color-warning-light)',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-accent-text)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'var(--color-warning)',
              animation: 'pulse 1.5s ease-in-out infinite',
              display: 'inline-block',
            }}
            aria-hidden="true"
          />
          Maintenance Mode Aktif
        </div>

        {/* Footer note */}
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-disabled)',
            textAlign: 'center',
          }}
        >
          Jika Anda adalah Admin, silakan{' '}
          <a
            href="/login"
            style={{
              color: 'var(--color-primary)',
              fontWeight: 'var(--weight-medium)',
              textDecoration: 'none',
            }}
          >
            login di sini
          </a>
          .
        </p>
      </div>
    </div>
  );
}
