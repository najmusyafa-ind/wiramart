'use client';

// =============================================================
// Wiramart v2.0 — CategoryBar Component
// Bar kategori horizontal scrollable dengan active pill indicator.
// =============================================================

import React from 'react';

export interface CategoryInfo {
  id: string;
  name: string;
  count: number;
}

interface CategoryBarProps {
  categories: CategoryInfo[];
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
}

export default function CategoryBar({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: CategoryBarProps) {
  return (
    <nav className="pwa-category-scroll" aria-label="Kategori Produk">
      <button
        type="button"
        className={`pwa-category-pill ${selectedCategoryId === 'ALL' ? 'active' : ''}`}
        onClick={() => onSelectCategory('ALL')}
      >
        <span>Semua</span>
      </button>

      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          className={`pwa-category-pill ${selectedCategoryId === cat.id ? 'active' : ''}`}
          onClick={() => onSelectCategory(cat.id)}
        >
          <span>{cat.name}</span>
          <span style={{ opacity: 0.75, fontSize: 11 }}>({cat.count})</span>
        </button>
      ))}
    </nav>
  );
}
