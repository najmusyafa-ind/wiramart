'use client';

// =============================================================
// Wiramart v2.0 — ProductCard Component (Mobile-First)
// Card katalog dengan stock badge, foto/fallback, & direct stepper.
// =============================================================

import React from 'react';
import Image from 'next/image';
import {
  Plus,
  Minus,
  Package,
  CupSoda,
  UtensilsCrossed,
  Cookie,
  Sparkles,
  Check,
} from 'lucide-react';
import type { KatalogItem } from '@/features/order/katalog.service';
import { useCart } from '@/features/order/cart.context';

interface ProductCardProps {
  product: KatalogItem;
  lowStockThreshold?: number;
  index?: number;
}

function getCategoryVisual(categoryName: string, productName: string): {
  themeClass: string;
  Icon: typeof Package;
  tagLabel: string;
} {
  const cat = categoryName.toLowerCase();
  const name = productName.toLowerCase();
  if (cat.includes('minum') || name.includes('es ') || name.includes('kopi') || name.includes('tea') || name.includes('aqua') || name.includes('coca')) {
    return { themeClass: 'pwa-visual-drink', Icon: CupSoda, tagLabel: 'Segar & Dingin' };
  }
  if (cat.includes('makan') || name.includes('nasi') || name.includes('mie') || name.includes('ayam') || name.includes('roti')) {
    return { themeClass: 'pwa-visual-food', Icon: UtensilsCrossed, tagLabel: 'Siap Santap' };
  }
  if (cat.includes('jajan') || name.includes('snack') || name.includes('permen') || name.includes('coklat')) {
    return { themeClass: 'pwa-visual-snack', Icon: Cookie, tagLabel: 'Camilan Kampus' };
  }
  return { themeClass: 'pwa-visual-general', Icon: Sparkles, tagLabel: 'Wiramart UNPERBA' };
}

export default function ProductCard({
  product,
  lowStockThreshold = 5,
  index = 0,
}: ProductCardProps) {
  const { addItem, updateQuantity, getItemQuantity } = useCart();
  const [imgError, setImgError] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [justAdded, setJustAdded] = React.useState(false);
  const qtyInCart = getItemQuantity(product.id);

  const bundleStep = product.sellingPrice === 250 ? 2 : 1;
  const displayPrice = bundleStep === 2 ? product.sellingPrice * 2 : product.sellingPrice;
  const displayUnit = bundleStep === 2 ? '2 pcs' : product.unit;

  const isOutOfStock = !product.isAvailable || product.stockQty < bundleStep;
  const isLowStock =
    !isOutOfStock && (product.isLowStock ?? product.stockQty <= lowStockThreshold);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const triggerPop = () => {
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 420);
  };

  const handleAdd = () => {
    const ok = addItem(product, bundleStep);
    if (!ok) {
      showToast('Maks. 10 jenis produk per pesanan');
      return;
    }
    triggerPop();
  };

  const handleIncrement = () => {
    if (qtyInCart + bundleStep <= product.stockQty) {
      updateQuantity(product.id, qtyInCart + bundleStep);
      triggerPop();
    }
  };

  const handleDecrement = () => {
    updateQuantity(product.id, qtyInCart - bundleStep);
  };

  const formattedPrice = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(displayPrice);

  const { themeClass, Icon, tagLabel } = getCategoryVisual(product.categoryName, product.name);
  const staggerDelayMs = Math.min(index, 11) * 35;

  return (
    <div
      className={`pwa-card${qtyInCart > 0 ? ' pwa-card--in-cart' : ''}${justAdded ? ' pwa-card--pop' : ''}`}
      style={{ animationDelay: `${staggerDelayMs}ms` }}
    >
      {/* Image Wrap */}
      <div className={`pwa-card-image-wrap ${themeClass}`}>
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
            <div className="pwa-card-fallback-orb">
              <Icon size={30} strokeWidth={1.75} />
            </div>
            <span>{tagLabel}</span>
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
          <span className="pwa-card-unit">/{displayUnit}</span>
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
            <span className={`pwa-stepper-qty${justAdded ? ' pwa-qty-bounce' : ''}`}>
              {justAdded ? <Check size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> : qtyInCart}
            </span>
            <button
              type="button"
              className="pwa-stepper-btn"
              onClick={handleIncrement}
              disabled={qtyInCart + bundleStep > product.stockQty}
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
            <Plus size={14} className="pwa-btn-add-icon" />
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
