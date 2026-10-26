'use client';

// =============================================================
// Wiramart v2.0 — ProductCard Component (Mobile-First)
// Card katalog dengan stock badge, foto/fallback, & direct stepper.
// =============================================================

import React from 'react';
import Image from 'next/image';
import { Plus, Minus, Package } from 'lucide-react';
import type { KatalogItem } from '@/features/order/katalog.service';
import { useCart } from '@/features/order/cart.context';

interface ProductCardProps {
  product: KatalogItem;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { addItem, updateQuantity, getItemQuantity } = useCart();
  const [imgError, setImgError] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const qtyInCart = getItemQuantity(product.id);

  const isOutOfStock = !product.isAvailable || product.stockQty <= 0;
  const isLowStock = !isOutOfStock && product.stockQty <= 5;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleAdd = () => {
    const ok = addItem(product, 1);
    if (!ok) {
      showToast('Maks. 10 jenis produk per pesanan');
    }
  };

  const handleIncrement = () => {
    if (qtyInCart < product.stockQty) {
      updateQuantity(product.id, qtyInCart + 1);
    }
  };

  const handleDecrement = () => {
    updateQuantity(product.id, qtyInCart - 1);
  };

  const formattedPrice = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(product.sellingPrice);

  return (
    <div className="pwa-card">
      {/* Image Wrap */}
      <div className="pwa-card-image-wrap">
        {product.photoUrl && !imgError ? (
          <Image
            src={product.photoUrl}
            alt={product.name}
            className="pwa-card-image"
            width={240}
            height={240}
            loading="lazy"
            unoptimized
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="pwa-card-fallback-icon">
            <Package size={34} strokeWidth={1.5} />
            <span>Wiramart</span>
          </div>
        )}

        {/* Stock Badge */}
        {isOutOfStock ? (
          <span className="pwa-card-badge pwa-badge-out">Habis</span>
        ) : isLowStock ? (
          <span className="pwa-card-badge pwa-badge-low">Sisa {product.stockQty}</span>
        ) : (
          <span className="pwa-card-badge pwa-badge-available">Stok {product.stockQty}</span>
        )}
      </div>

      {/* Body */}
      <div className="pwa-card-body">
        <span className="pwa-card-category">{product.categoryName}</span>
        <h3 className="pwa-card-title" title={product.name}>
          {product.name}
        </h3>

        <div className="pwa-card-price-row">
          <span className="pwa-card-price">{formattedPrice}</span>
          <span className="pwa-card-unit">/{product.unit}</span>
        </div>

        {/* Action Button */}
        {isOutOfStock ? (
          <button type="button" className="pwa-btn-add" disabled>
            Habis
          </button>
        ) : qtyInCart > 0 ? (
          <div className="pwa-stepper">
            <button
              type="button"
              className="pwa-stepper-btn"
              onClick={handleDecrement}
              aria-label="Kurangi jumlah"
            >
              <Minus size={14} />
            </button>
            <span className="pwa-stepper-qty">{qtyInCart}</span>
            <button
              type="button"
              className="pwa-stepper-btn"
              onClick={handleIncrement}
              disabled={qtyInCart >= product.stockQty}
              aria-label="Tambah jumlah"
            >
              <Plus size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="pwa-btn-add"
            onClick={handleAdd}
            aria-label={`Tambah ${product.name} ke keranjang`}
          >
            <Plus size={14} />
            <span>Tambah</span>
          </button>
        )}
      </div>

      {/* Inline toast notif — hanya muncul 2.2 detik */}
      {toast && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            background: 'hsl(145, 50%, 20%)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            padding: '6px 10px',
            borderRadius: 8,
            textAlign: 'center',
            zIndex: 10,
            animation: 'pwaFadeIn 0.2s ease',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
