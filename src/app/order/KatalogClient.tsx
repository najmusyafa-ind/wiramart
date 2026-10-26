'use client';

// =============================================================
// Wiramart v2.0 — KatalogClient
// Client view interaktif untuk search, filter kategori & grid produk.
// =============================================================

import React, { useState, useMemo } from 'react';
import type { KatalogItem } from '@/features/order/katalog.service';
import KatalogHeader from './components/KatalogHeader';
import CategoryBar, { type CategoryInfo } from './components/CategoryBar';
import ProductCard from './components/ProductCard';
import CartFloatingBar from './components/CartFloatingBar';
import { SearchX, RefreshCw } from 'lucide-react';

interface KatalogClientProps {
  initialItems: KatalogItem[];
}

export default function KatalogClient({ initialItems }: KatalogClientProps) {
  const [items, setItems] = useState<KatalogItem[]>(initialItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Dynamic Categories from available products
  const categories: CategoryInfo[] = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    for (const item of items) {
      const existing = map.get(item.categoryId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(item.categoryId, {
          id: item.categoryId,
          name: item.categoryName,
          count: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return items.filter((product) => {
      const matchesCategory =
        selectedCategoryId === 'ALL' || product.categoryId === selectedCategoryId;
      const matchesSearch =
        q.length === 0 ||
        product.name.toLowerCase().includes(q) ||
        product.categoryName.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [items, searchQuery, selectedCategoryId]);

  // Pull-to-refresh or reload catalog
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/order/katalog', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.items) {
          setItems(json.data.items);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Sticky Header with Search */}
      <KatalogHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* Categories Horizontal Scroll */}
      <CategoryBar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
      />

      {/* Catalog Meta Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px 12px 16px',
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--pwa-text-muted)', fontWeight: 500 }}>
          Menampilkan <strong>{filteredProducts.length}</strong> produk
        </span>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pwa-primary)',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}
          title="Segarkan data stok"
        >
          <RefreshCw
            size={12}
            style={{
              animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
            }}
          />
          <span>{isRefreshing ? 'Memuat...' : 'Segarkan'}</span>
        </button>
      </div>

      {/* Product Grid / Empty Search */}
      {filteredProducts.length === 0 ? (
        <div className="pwa-empty-state" style={{ margin: 'auto 0' }}>
          <div className="pwa-empty-icon">
            <SearchX size={32} />
          </div>
          <h3 className="pwa-empty-title">Produk Tidak Ditemukan</h3>
          <p className="pwa-empty-desc">
            {searchQuery
              ? `Tidak ada produk dengan kata kunci "${searchQuery}". Coba kata kunci lain.`
              : 'Belum ada produk aktif di kategori ini.'}
          </p>
        </div>
      ) : (
        <div className="pwa-product-grid">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Floating Cart Indicator */}
      <CartFloatingBar />
    </main>
  );
}
