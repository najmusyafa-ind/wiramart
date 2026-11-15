'use client';

// =============================================================
// Wiramart v2.0 — /kasir/pengiriman
// Tab "Pengiriman Saya" untuk CS / Runner Kampus (Karyawan / Kasir).
// Ponytail Mode: Minimal boilerplate, direct API fetch, accessible mobile UI.
// =============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  RefreshCw,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Inbox,
} from 'lucide-react';

interface DeliveryItem {
  id: string;
  productName: string;
  quantity: number;
  subtotal: number;
}

interface DeliveryOrder {
  id: string;
  orderNumber: string;
  status: 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'COMPLETED';
  deliveryType: 'PICKUP' | 'DELIVERY';
  deliveryFloor: number | null;
  roomDetail: string | null;
  deliveryNote: string | null;
  paymentMethod: 'QRIS' | 'TRANSFER';
  totalAmount: number;
  noShowCount: number;
  handoverConfirmedAt: string | null;
  createdAt: string;
  buyerName: string;
  buyerNim: string;
  buyerWhatsapp: string;
  items: DeliveryItem[];
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const floorLabel = (f: number | null) => (f === 99 ? 'Auditorium' : f ? `Lantai ${f}` : '-');

export default function PengirimanRunnerPage() {
  const [orders, setOrders] = useState<DeliveryOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmNoShowId, setConfirmNoShowId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ id: string; type: 'ok' | 'err'; text: string } | null>(null);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [packedChecklist, setPackedChecklist] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cs/pengiriman', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(typeof json?.error === 'string' ? json.error : 'Gagal memuat tugas pengiriman.');
        return;
      }
      setOrders(json.data.deliveries as DeliveryOrder[]);
      setError(null);
    } catch {
      setError('Koneksi terganggu. Mencoba lagi otomatis...');
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [load]);

  async function act(
    orderId: string,
    body: { action: 'berangkat' } | { action: 'verifikasi-pin'; pin: string } | { action: 'no-show' },
  ) {
    if (busyId) return;
    setBusyId(orderId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/cs/pengiriman/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionMsg({
          id: orderId,
          type: 'err',
          text: typeof json?.error === 'string' ? json.error : 'Aksi gagal.',
        });
      } else {
        setActionMsg({
          id: orderId,
          type: 'ok',
          text: json.data?.message ?? 'Berhasil diperbarui!',
        });
        if (body.action === 'verifikasi-pin') {
          setPinInputs((prev) => ({ ...prev, [orderId]: '' }));
        }
      }
      await load();
    } catch {
      setActionMsg({ id: orderId, type: 'err', text: 'Koneksi jaringan bermasalah.' });
    } finally {
      setBusyId(null);
    }
  }

  function toggleCheck(itemId: string) {
    setPackedChecklist((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  const activeOrders = orders?.filter((o) => o.status !== 'COMPLETED') ?? [];
  const completedOrders = orders?.filter((o) => o.status === 'COMPLETED') ?? [];

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))',
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          paddingBottom: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Link
            href="/kasir/pos"
            aria-label="Kembali ke POS"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text)',
              textDecoration: 'none',
            }}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </Link>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Pengiriman Saya</h1>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Tugas runner / delivery kampus Wiramart
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={load}
          aria-label="Muat ulang tugas"
          style={{
            minHeight: 44,
            background: 'var(--color-surface-muted)',
            borderRadius: 'var(--radius-md)',
            padding: '0 14px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '13px',
            color: 'var(--color-text)',
          }}
        >
          <RefreshCw size={14} aria-hidden="true" className={orders === null ? 'spin-icon' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-error-light)',
            color: 'var(--color-error)',
            fontSize: '13px',
            border: '1px solid var(--color-error)',
          }}
        >
          {error}
        </div>
      )}

      {/* Content */}
      {orders === null ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '64px 0' }}>
          <Loader2 size={32} className="spin-icon" style={{ color: 'var(--color-primary)' }} />
          <p style={{ marginTop: 8, fontSize: '13px', color: 'var(--color-text-muted)' }}>Memuat tugas pengiriman...</p>
        </div>
      ) : activeOrders.length === 0 && completedOrders.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 20px',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <Inbox size={44} aria-hidden="true" style={{ opacity: 0.3, margin: '0 auto 8px' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Tidak ada tugas pengantaran</h3>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--color-text-muted)' }}>
            Pesanan delivery yang di-assign oleh admin akan muncul di sini.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Active Deliveries */}
          {activeOrders.map((o) => {
            const isBusy = busyId === o.id;
            const msg = actionMsg?.id === o.id ? actionMsg : null;
            const pinVal = pinInputs[o.id] ?? '';

            return (
              <div
                key={o.id}
                style={{
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-lg)',
                  border: `1.5px solid ${o.status === 'OUT_FOR_DELIVERY' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                {/* Header card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <span style={{ fontSize: '15px', fontWeight: 800 }}>#{o.orderNumber}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)' }}>
                      <MapPin size={14} />
                      <span>{floorLabel(o.deliveryFloor)} · Ruang {o.roomDetail ?? '-'}</span>
                    </div>
                  </div>

                  <span
                    className={`badge ${
                      o.status === 'OUT_FOR_DELIVERY' ? 'badge-primary' : o.status === 'PREPARING' ? 'badge-info' : 'badge-warning'
                    }`}
                    style={{ fontSize: '12px' }}
                  >
                    {o.status === 'OUT_FOR_DELIVERY' ? 'Sedang Diantar' : o.status === 'PREPARING' ? 'Siap Diantar' : 'Dikonfirmasi'}
                  </span>
                </div>

                {/* Buyer info */}
                <div
                  style={{
                    background: 'var(--color-surface-muted)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    fontSize: '13px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                    <strong>{o.buyerName}</strong> (NIM: {o.buyerNim})
                    {o.deliveryNote && (
                      <div style={{ fontStyle: 'italic', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                        “{o.deliveryNote}”
                      </div>
                    )}
                  </div>
                  <a
                    href={`https://wa.me/${o.buyerWhatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Hubungi ${o.buyerName} via WhatsApp`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      minHeight: 44,
                      minWidth: 44,
                      flexShrink: 0,
                      background: 'hsl(142, 70%, 28%)',
                      color: 'var(--color-text-inverse, hsl(0, 0%, 100%))',
                      padding: '0 14px',
                      borderRadius: 'var(--radius-full)',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    <MessageCircle size={15} aria-hidden="true" /> WA
                  </a>
                </div>

                {/* Items Packing Checklist */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    Daftar Produk ({o.items.length}) — Centang saat mengemas:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {o.items.map((it) => {
                      const checked = !!packedChecklist[it.id];
                      return (
                        <label
                          key={it.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            minHeight: 44,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: checked ? 'var(--color-primary-light)' : 'var(--color-surface-muted)',
                            cursor: 'pointer',
                            fontSize: '13.5px',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCheck(it.id)}
                            style={{ accentColor: 'var(--color-primary)', width: 20, height: 20, flexShrink: 0 }}
                          />
                          <span style={{ flex: 1, textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.7 : 1 }}>
                            {it.productName} <strong>× {it.quantity}</strong>
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{rp(it.subtotal)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Status-specific action box */}
                {o.status === 'PREPARING' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isBusy}
                    onClick={() => act(o.id, { action: 'berangkat' })}
                    style={{
                      width: '100%',
                      minHeight: 46,
                      borderRadius: 'var(--radius-md)',
                      background: 'linear-gradient(135deg, var(--color-primary), hsl(145, 65%, 26%))',
                      color: 'var(--color-text-inverse, hsl(0, 0%, 100%))',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px hsla(145, 64%, 28%, 0.25)',
                    }}
                  >
                    {isBusy ? <Loader2 size={16} aria-hidden="true" className="spin-icon" /> : <Send size={16} aria-hidden="true" />}
                    <span>Siapkan & Berangkat Sekarang</span>
                  </button>
                )}

                {o.status === 'OUT_FOR_DELIVERY' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px dashed var(--color-border)', paddingTop: 10 }}>
                    <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ShieldCheck size={14} aria-hidden="true" style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                      <span>Minta <strong>PIN 6-digit</strong> dari pembeli saat tiba:</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={6}
                        placeholder="6 Digit PIN"
                        aria-label={`PIN 6 digit untuk pesanan ${o.buyerName}`}
                        value={pinVal}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setPinInputs((prev) => ({ ...prev, [o.id]: val }));
                        }}
                        style={{
                          flex: '1 1 160px',
                          minWidth: 140,
                          minHeight: 44,
                          padding: '0 12px',
                          fontSize: '18px',
                          fontWeight: 800,
                          textAlign: 'center',
                          letterSpacing: '0.2em',
                          borderRadius: 'var(--radius-md)',
                          border: '1.5px solid var(--color-border)',
                          background: 'var(--color-surface, hsl(0, 0%, 100%))',
                          color: 'var(--color-text)',
                        }}
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={isBusy || pinVal.length !== 6}
                        onClick={() => act(o.id, { action: 'verifikasi-pin', pin: pinVal })}
                        style={{
                          padding: '0 16px',
                          minHeight: 44,
                          flexShrink: 0,
                          borderRadius: 'var(--radius-md)',
                          background: pinVal.length === 6 ? 'var(--color-primary)' : 'var(--color-surface-muted)',
                          color: pinVal.length === 6 ? 'var(--color-text-inverse, hsl(0, 0%, 100%))' : 'var(--color-text-muted)',
                          border: 'none',
                          fontWeight: 700,
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: pinVal.length === 6 ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {isBusy ? <Loader2 size={14} aria-hidden="true" className="spin-icon" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                        <span>Verifikasi</span>
                      </button>
                    </div>

                    {confirmNoShowId === o.id ? (
                      <div
                        role="alert"
                        style={{
                          background: 'var(--color-error-light, hsl(0, 80%, 96%))',
                          border: '1px solid var(--color-error)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-error)' }}>
                          Yakin catat pembeli tidak ada di lokasi?
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={isBusy}
                            onClick={() => setConfirmNoShowId(null)}
                            style={{ minHeight: 44, padding: '0 14px' }}
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmNoShowId(null);
                              void act(o.id, { action: 'no-show' });
                            }}
                            style={{ minHeight: 44, padding: '0 14px' }}
                          >
                            Ya, Catat No-Show
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 2 }}>
                        <span style={{ fontSize: '12px', color: o.noShowCount > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                          {o.noShowCount > 0 ? `Sudah dicatat ${o.noShowCount}x no-show` : ''}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={isBusy}
                          onClick={() => setConfirmNoShowId(o.id)}
                          style={{
                            color: 'var(--color-error)',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            minHeight: 44,
                            padding: '0 12px',
                          }}
                        >
                          <AlertTriangle size={14} aria-hidden="true" />
                          <span>Pembeli Tidak Ada</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Message */}
                {msg && (
                  <div
                    role="alert"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '12.5px',
                      background: msg.type === 'ok' ? 'var(--color-primary-light)' : 'var(--color-error-light)',
                      color: msg.type === 'ok' ? 'var(--color-primary)' : 'var(--color-error)',
                      border: `1px solid ${msg.type === 'ok' ? 'var(--color-primary)' : 'var(--color-error)'}`,
                    }}
                  >
                    {msg.text}
                  </div>
                )}
              </div>
            );
          })}

          {/* Completed Section (Collapse / History) */}
          {completedOrders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Selesai Hari Ini ({completedOrders.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {completedOrders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      background: 'var(--color-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      padding: '10px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '13px',
                      opacity: 0.8,
                    }}
                  >
                    <div>
                      <strong>#{o.orderNumber}</strong> · {o.buyerName} · {floorLabel(o.deliveryFloor)}
                    </div>
                    <span className="badge badge-success" style={{ fontSize: '11px' }}>
                      Selesai
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
