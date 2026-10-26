'use client';

// =============================================================
// Wiramart v2.0 — Cart & Buyer Context (PWA Client State)
// Persisted di localStorage agar tidak hilang saat refresh.
// =============================================================

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { KatalogItem } from './katalog.service';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  photoUrl: string | null;
  stockQty: number;
  unit: string;
}

export interface BuyerProfile {
  id: string;
  fullName: string;
  nim: string;
}

interface CartContextType {
  items: CartItem[];
  addItem: (product: KatalogItem, quantity?: number) => boolean;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  getItemQuantity: (productId: string) => number;
  totalItems: number;
  distinctCount: number;
  subtotal: number;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  buyer: BuyerProfile | null;
  isLoadingBuyer: boolean;
  refreshBuyer: () => Promise<void>;
  logoutBuyer: () => Promise<void>;
}

const CartContext = createContext<CartContextType | null>(null);

const STORAGE_KEY = 'wiramart_pwa_cart_v2';
const MAX_DISTINCT_ITEMS = 10; // Sesuai Zod CreateOrderSchema max 10 types
const MAX_ITEM_QTY = 50;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [buyer, setBuyer] = useState<BuyerProfile | null>(null);
  const [isLoadingBuyer, setIsLoadingBuyer] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // 1. Hydrate cart from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }
    } catch {
      // localStorage error fallback
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // 2. Persist cart to localStorage on change
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // QuotaExceeded or private browsing safeguard
    }
  }, [items, isHydrated]);

  // 3. Fetch buyer session
  const refreshBuyer = useCallback(async () => {
    try {
      setIsLoadingBuyer(true);
      const res = await fetch('/api/order/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.authenticated) {
          setBuyer(json.data.buyer);
        } else {
          setBuyer(null);
        }
      } else {
        setBuyer(null);
      }
    } catch {
      setBuyer(null);
    } finally {
      setIsLoadingBuyer(false);
    }
  }, []);

  useEffect(() => {
    refreshBuyer();
  }, [refreshBuyer]);

  const logoutBuyer = useCallback(async () => {
    try {
      await fetch('/api/order/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setBuyer(null);
    }
  }, []);

  // Add item with stock constraint & max 10 distinct products check
  const addItem = useCallback(
    (product: KatalogItem, quantity: number = 1): boolean => {
      if (!product.isAvailable || product.stockQty <= 0) return false;

      let success = true;
      setItems((prev) => {
        const existingIndex = prev.findIndex((i) => i.productId === product.id);

        if (existingIndex > -1) {
          const current = prev[existingIndex];
          const newQty = Math.min(current.quantity + quantity, product.stockQty, MAX_ITEM_QTY);
          const next = [...prev];
          next[existingIndex] = { ...current, quantity: newQty };
          return next;
        }

        // Limit 10 distinct products in 1 order — caller harus tampilkan notif
        if (prev.length >= MAX_DISTINCT_ITEMS) {
          success = false;
          return prev;
        }

        const validQty = Math.min(quantity, product.stockQty, MAX_ITEM_QTY);
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.sellingPrice,
            quantity: validQty,
            photoUrl: product.photoUrl,
            stockQty: product.stockQty,
            unit: product.unit,
          },
        ];
      });

      return success;
    },
    [],
  );

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) {
        return prev.filter((i) => i.productId !== productId);
      }
      return prev.map((item) => {
        if (item.productId === productId) {
          const clamped = Math.min(quantity, item.stockQty, MAX_ITEM_QTY);
          return { ...item, quantity: clamped };
        }
        return item;
      });
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const getItemQuantity = useCallback(
    (productId: string): number => {
      const item = items.find((i) => i.productId === productId);
      return item ? item.quantity : 0;
    },
    [items],
  );

  const totalItems = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);
  const distinctCount = items.length;
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.price * i.quantity, 0), [items]);

  const value = useMemo(
    () => ({
      items,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      getItemQuantity,
      totalItems,
      distinctCount,
      subtotal,
      isDrawerOpen,
      setIsDrawerOpen,
      buyer,
      isLoadingBuyer,
      refreshBuyer,
      logoutBuyer,
    }),
    [
      items,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      getItemQuantity,
      totalItems,
      distinctCount,
      subtotal,
      isDrawerOpen,
      buyer,
      isLoadingBuyer,
      refreshBuyer,
      logoutBuyer,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
