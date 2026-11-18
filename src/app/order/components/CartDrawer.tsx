'use client';

// =============================================================
// Wiramart v2.0 — CartDrawer Component
// Bottom sheet drawer keranjang belanja dengan item stepper & a11y dialog.
// =============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, Info } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CartDrawer() {
  const {
    items,
    totalItems,
    subtotal,
    isDrawerOpen,
    setIsDrawerOpen,
    updateQuantity,
    removeItem,
    clearCart,
  } = useCart();

  const [confirmClear, setConfirmClear] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const closeDrawer = useCallback(() => {
    setConfirmClear(false);
    setIsDrawerOpen(false);
  }, [setIsDrawerOpen]);

  // Focus management + focus trap + ESC handler
  useEffect(() => {
    if (!isDrawerOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const rafId = window.requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [isDrawerOpen, closeDrawer]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  if (!isDrawerOpen) return null;

  const formattedSubtotal = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(subtotal);

  return (
    <div className="pwa-drawer-backdrop" onClick={closeDrawer}>
      <div
        ref={panelRef}
        className="pwa-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
      >
        <div className="pwa-drawer-handle" />

        {/* Header */}
        <div className="pwa-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 id="cart-drawer-title" className="pwa-drawer-title">
              Keranjang Pesanan ({totalItems})
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {items.length > 0 && !confirmClear && (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="pwa-inline-action-btn"
                style={{ color: 'hsl(0, 65%, 36%)' }}
              >
                Kosongkan
              </button>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              className="pwa-drawer-close"
              onClick={closeDrawer}
              aria-label="Tutup keranjang"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Inline 2-Step Confirm Bar (pengganti window.confirm) */}
        {confirmClear && items.length > 0 && (
          <div
            role="region"
            aria-label="Konfirmasi kosongkan keranjang"
            style={{
              padding: '12px 18px',
              background: 'hsl(0, 85%, 97%)',
              borderBottom: '1px solid hsl(0, 70%, 88%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(0, 65%, 32%)' }}>
              Kosongkan semua produk dari keranjang?
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="pwa-btn-secondary"
                style={{ flex: 1 }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  clearCart();
                  setConfirmClear(false);
                }}
                className="pwa-btn-danger-outline"
                style={{ flex: 1 }}
              >
                Ya, Kosongkan
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="pwa-drawer-body">
          {items.length === 0 ? (
            <div className="pwa-empty-state">
              <div className="pwa-empty-icon">
                <ShoppingBag size={28} aria-hidden="true" />
              </div>
              <h3 className="pwa-empty-title">Keranjang Belanja Anda Kosong</h3>
              <p className="pwa-empty-desc">
                Pilih makanan ringan, minuman, atau perlengkapan kampus dari katalog untuk mulai memesan.
              </p>
            </div>
          ) : (
            items.map((item) => {
              const itemTotal = item.price * item.quantity;
              const formattedItemTotal = new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                maximumFractionDigits: 0,
              }).format(itemTotal);

              return (
                <div key={item.productId} className="pwa-drawer-item">
                  <div className="pwa-drawer-item-info">
                    <div className="pwa-drawer-item-name">{item.name}</div>
                    <div className="pwa-drawer-item-sub">
                      {formattedItemTotal}{' '}
                      <span style={{ fontSize: 12, color: 'var(--pwa-text-muted)', fontWeight: 400 }}>
                        (@ Rp {item.price.toLocaleString('id-ID')})
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--pwa-surface-muted)',
                        borderRadius: 'var(--pwa-radius-sm)',
                        border: '1px solid var(--pwa-border)',
                      }}
                    >
                      <button
                        type="button"
                        className="pwa-stepper-compact-btn"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        aria-label={`Kurangi jumlah ${item.name}`}
                      >
                        <Minus size={14} aria-hidden="true" />
                      </button>
                      <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700, fontSize: 13.5 }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="pwa-stepper-compact-btn"
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        disabled={item.quantity >= item.stockQty}
                        aria-label={`Tambah jumlah ${item.name}`}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="pwa-icon-action-btn"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Hapus ${item.name}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="pwa-drawer-footer">
            <div className="pwa-drawer-summary-row">
              <span style={{ color: 'var(--pwa-text-muted)', fontWeight: 500 }}>Subtotal Barang</span>
              <span className="pwa-drawer-summary-total">{formattedSubtotal}</span>
            </div>

            <p
              style={{
                fontSize: 12,
                color: 'var(--pwa-text-muted)',
                margin: '0 0 4px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Info size={14} style={{ flexShrink: 0, color: 'var(--pwa-primary)' }} aria-hidden="true" />
              <span>Ongkos kirim dihitung berdasarkan lantai tujuan pada langkah checkout.</span>
            </p>

            <Link
              href="/order/checkout"
              className="pwa-btn-checkout"
              onClick={closeDrawer}
            >
              <span>Lanjut ke Checkout</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
