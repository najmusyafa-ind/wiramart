'use client';

// =============================================================
// Wiramart v2.0 — CartDrawer Component
// Bottom sheet drawer keranjang belanja dengan item stepper.
// =============================================================

import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

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

  // Close drawer on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, setIsDrawerOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
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
    <div className="pwa-drawer-backdrop" onClick={() => setIsDrawerOpen(false)}>
      <div
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Kosongkan semua produk dari keranjang?')) {
                    clearCart();
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'hsl(0, 72%, 50%)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Kosongkan
              </button>
            )}
            <button
              type="button"
              className="pwa-drawer-close"
              onClick={() => setIsDrawerOpen(false)}
              aria-label="Tutup keranjang"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="pwa-drawer-body">
          {items.length === 0 ? (
            <div className="pwa-empty-state">
              <div className="pwa-empty-icon">
                <ShoppingBag size={28} />
              </div>
              <h3 className="pwa-empty-title">Keranjang Kamu Kosong</h3>
              <p className="pwa-empty-desc">
                Pilih snack, minuman, atau perlengkapan kampus dari katalog untuk memesan.
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
                      <span style={{ fontSize: 11, color: 'var(--pwa-text-muted)', fontWeight: 400 }}>
                        (@ Rp {item.price.toLocaleString('id-ID')})
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--pwa-surface-muted)',
                        borderRadius: 8,
                        padding: '2px 4px',
                        border: '1px solid var(--pwa-border)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 4,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Minus size={13} />
                      </button>
                      <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        disabled={item.quantity >= item.stockQty}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 4,
                          cursor: item.quantity >= item.stockQty ? 'not-allowed' : 'pointer',
                          opacity: item.quantity >= item.stockQty ? 0.4 : 1,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Hapus ${item.name}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--pwa-text-light)',
                        cursor: 'pointer',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={16} />
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

            <p style={{ fontSize: 11.5, color: 'var(--pwa-text-muted)', margin: '0 0 4px 0' }}>
              💡 Ongkos kirim dihitung berdasarkan lantai tujuan pada langkah checkout.
            </p>

            <Link
              href="/order/checkout"
              className="pwa-btn-checkout"
              onClick={() => setIsDrawerOpen(false)}
            >
              <span>Lanjut ke Checkout</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
