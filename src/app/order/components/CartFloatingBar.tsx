'use client';

// =============================================================
// Wiramart v2.0 — CartFloatingBar Component
// Bar melayang di bawah layar saat keranjang berisi produk.
// =============================================================

import React from 'react';
import { ShoppingBag, ChevronRight } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

export default function CartFloatingBar() {
  const { totalItems, distinctCount, subtotal, setIsDrawerOpen } = useCart();

  if (totalItems === 0) return null;

  const formattedSubtotal = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(subtotal);

  return (
    <div className="pwa-floating-bar" role="region" aria-label="Ringkasan Keranjang">
      <button
        type="button"
        className="pwa-floating-bar-inner"
        onClick={() => setIsDrawerOpen(true)}
        aria-label={`Buka keranjang, ${totalItems} item, ${formattedSubtotal}`}
      >
        <div className="pwa-floating-bar-info">
          <div className="pwa-floating-cart-count">
            <ShoppingBag size={20} aria-hidden="true" />
            <span className="pwa-floating-badge">{totalItems}</span>
          </div>

          <div className="pwa-floating-price-wrap">
            <span className="pwa-floating-items-label">{distinctCount} jenis item</span>
            <span className="pwa-floating-total">{formattedSubtotal}</span>
          </div>
        </div>

        <div className="pwa-floating-cta">
          <span>Keranjang</span>
          <ChevronRight size={16} aria-hidden="true" />
        </div>
      </button>
    </div>
  );
}
