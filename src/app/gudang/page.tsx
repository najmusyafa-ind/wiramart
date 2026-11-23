'use client';
// =============================================================
// src/app/kasir/gudang/page.tsx
// Portal Petugas Gudang & Manajemen Logistik Wiramart UNPERBA
// Standar: Mobile-First UI, Proteksi HPP, Radar FEFO
// =============================================================

import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard';
import {
  clearIdleStorage,
  getWarehouseIdleTimeoutPolicy,
} from '@/lib/utils/idle-timeout';
import { getDashboardPathForRole } from '@/lib/utils/routes';
import {
  Package,
  Clock,
  CheckCircle2,
  Search,
  Camera,
  Plus,
  RefreshCw,
  LogOut,
  ChevronLeft,
  Boxes,
  Calendar,
  X,
  History,
  Barcode,
  Layers,
  AlertCircle,
  Sparkles,
  Bell,
  XCircle,
  AlertTriangle,
  Pencil,
  Trash2,
} from 'lucide-react';
import PenerimaanBarangSection from './components/PenerimaanBarangSection';
import FEFOActionSection from './components/FEFOActionSection';

// ── Tipe Data Frontend ─────────────────────────────────────────

type WarehouseEmployee = {
  id: string;
  name: string;
  nim: string;
  jabatan: string;
  canMutateStock?: boolean;
  actorRole?: 'EMPLOYEE' | 'MANAGER' | 'ADMIN_SHIFT';
  sessionIssuedAtMs?: number;
};

type WarehouseSummary = {
  totalSku: number;
  outOfStockSku: number;
  lowStockSku: number;
  lowStockThreshold?: number;
  expiringSoonSku: number;
  todayRestockCount: number;
  perishableSku?: number;
};

type WarehouseProduct = {
  id: string;
  name: string;
  barcode: string | null;
  categoryName: string;
  stockQty: number;
  unit: string;
  photoUrl: string | null;
  isPerishable: boolean;
  perishableType: string | null;
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'SAFE';
  nearestExpiryDate: string | null;
  expiryUrgency: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'NONE';
  activeBatchesCount: number;
};

type ActivityLog = {
  id: string;
  productId: string;
  productName: string;
  categoryName?: string;
  qtyDiff: number;
  reason: string;
  createdAt: string;
  actorName?: string;
  actorNim?: string;
  shiftInfo?: string;
  batchCode?: string;
  expiryDate?: string | null;
  notes?: string | null;
  formattedDate?: string;
  formattedTime?: string;
};

// BarcodeDetector Interface untuk Kamera HP
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(options?: { formats?: string[] });
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type ApprovalNotifItem = {
  id: string;
  receiveNumber: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';
  deliveryNote: string | null;
  managerNote: string | null;
  isNewProductProposal: boolean;
  productSummary: string;
  updatedAt: string;
};

type ApprovalNotificationsData = {
  rejectedCount: number;
  revisedCount: number;
  pendingCount: number;
  approvedTodayCount: number;
  recentItems: ApprovalNotifItem[];
};

const GUDANG_NOTIF_READ_KEY = 'wiramart_gudang_notif_read_ts_v1';

type WarehousePayloadData = {
  employee: WarehouseEmployee;
  summary: WarehouseSummary;
  items: WarehouseProduct[];
  activities: ActivityLog[];
  categories?: Array<{ id: string; name: string }>;
  approvalNotifications?: ApprovalNotificationsData;
};

function getTodayWibStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function addDaysWibStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

const warehouseDataMemCache = new Map<string, WarehousePayloadData>();

function makeWarehouseCacheKey(targetFilter: string, targetSearch: string): string {
  const filterParam =
    targetFilter === 'aktivitas' || targetFilter === 'penerimaan' ? 'semua' : targetFilter;
  return `${filterParam}::${targetSearch.trim().toLowerCase()}`;
}

export default function GudangPortalPage() {
  const router = useRouter();
  const searchInputId = useId();

  const initialCache = warehouseDataMemCache.get(makeWarehouseCacheKey('semua', ''));

  // State Data (inisialisasi instan dari memori cache)
  const [employee, setEmployee] = useState<WarehouseEmployee | null>(
    () => initialCache?.employee ?? null,
  );
  const [summary, setSummary] = useState<WarehouseSummary | null>(
    () => initialCache?.summary ?? null,
  );
  const [products, setProducts] = useState<WarehouseProduct[]>(
    () => initialCache?.items ?? [],
  );
  const [activities, setActivities] = useState<ActivityLog[]>(
    () => initialCache?.activities ?? [],
  );
  const [categoriesList, setCategoriesList] = useState<Array<{ id: string; name: string }>>(
    () => initialCache?.categories ?? [],
  );
  const [approvalNotifs, setApprovalNotifs] = useState<ApprovalNotificationsData | null>(
    () => initialCache?.approvalNotifications ?? null,
  );
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [penerimaanTargetFilter, setPenerimaanTargetFilter] = useState<
    'semua' | 'draft' | 'submitted' | 'revised' | 'approved' | 'rejected' | undefined
  >(undefined);
  const [penerimaanJumpSeq, setPenerimaanJumpSeq] = useState(0);
  const [lastReadNotifTs, setLastReadNotifTs] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      return Number(localStorage.getItem(GUDANG_NOTIF_READ_KEY) || '0') || 0;
    } catch {
      return 0;
    }
  });
  const [loading, setLoading] = useState<boolean>(() => !initialCache);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State Modal Ajukan Produk Baru (Evaluasi Pak Afif: Gudang ajukan -> ACC Manager)
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategoryId, setNewProdCategoryId] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdUnit, setNewProdUnit] = useState('pcs');
  const [newProdCostPrice, setNewProdCostPrice] = useState<string>('0');
  const [newProdSellingPrice, setNewProdSellingPrice] = useState<string>('');
  const [newProdInitialQty, setNewProdInitialQty] = useState<number>(1);
  const [newProdExpiryDate, setNewProdExpiryDate] = useState<string>('');
  const [newProdIsPerishable, setNewProdIsPerishable] = useState(false);
  const [newProdPerishableType, setNewProdPerishableType] = useState<'KONSINYASI' | 'BELI_LEPAS'>('KONSINYASI');
  const [newProdSupplier, setNewProdSupplier] = useState('');
  const [newProdNotes, setNewProdNotes] = useState('');
  const [submittingNewProd, setSubmittingNewProd] = useState(false);
  const [newProdError, setNewProdError] = useState<string | null>(null);
  const [newProdSuccessMsg, setNewProdSuccessMsg] = useState<string | null>(null);

  // State Filter & Pencarian
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'semua' | 'kritis' | 'fefo' | 'perishable' | 'habis' | 'aktivitas' | 'penerimaan'>('semua');

  function handleSelectTab(nextTab: 'semua' | 'kritis' | 'fefo' | 'perishable' | 'habis' | 'aktivitas' | 'penerimaan') {
    setActiveTab(nextTab);
    const cached = warehouseDataMemCache.get(makeWarehouseCacheKey(nextTab, search));
    if (cached) {
      setEmployee(cached.employee);
      setSummary(cached.summary);
      setProducts(cached.items);
      setActivities(cached.activities);
      if (cached.approvalNotifications) {
        setApprovalNotifs(cached.approvalNotifications);
      }
      setLoading(false);
    }
  }

  const canMutateStock = Boolean(employee && employee.canMutateStock !== false);
  const isReadOnlyAdminShift = Boolean(employee && employee.canMutateStock === false);
  const lowStockThreshold = summary?.lowStockThreshold ?? 5;

  // State Modal Restock
  const [selectedProduct, setSelectedProduct] = useState<WarehouseProduct | null>(null);
  const [restockQty, setRestockQty] = useState<number>(1);
  const [restockBonusQty, setRestockBonusQty] = useState<number>(0);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [batchCode, setBatchCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submittingRestock, setSubmittingRestock] = useState(false);
  const [restockSuccessMsg, setRestockSuccessMsg] = useState<string | null>(null);

  // State Modal Edit Produk & Tanggal Expired (Gudang + Admin Shift saling backup)
  const [editingProduct, setEditingProduct] = useState<WarehouseProduct | null>(null);
  const [editName, setEditName] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editUnit, setEditUnit] = useState('pcs');
  const [editStockQty, setEditStockQty] = useState<number>(0);
  const [editReason, setEditReason] = useState('');
  const [editBatches, setEditBatches] = useState<Array<{
    id: string;
    batchCode: string;
    currentQty: number;
    initialQty: number;
    expiryDate: string;
    originalExpiryDate: string | null;
  }>>([]);
  const [loadingEditBatches, setLoadingEditBatches] = useState(false);
  const [editSingleExpiryDate, setEditSingleExpiryDate] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editFetchSeqRef = useRef(0);

  // State Modal Rincian Multi-Batch FEFO
  const [viewingBatchProduct, setViewingBatchProduct] = useState<WarehouseProduct | null>(null);
  const [productBatches, setProductBatches] = useState<Array<{
    id: string;
    batchCode: string;
    currentQty: number;
    initialQty: number;
    expiryDate: string | null;
    expiryClass: string;
    expiryStatus: string;
    daysRemaining: number | null;
    receivedAt: string;
    notes: string | null;
  }>>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [inlineBatchEditId, setInlineBatchEditId] = useState<string | null>(null);
  const [inlineBatchExpiry, setInlineBatchExpiry] = useState('');
  const [savingInlineBatch, setSavingInlineBatch] = useState(false);
  const [inlineBatchError, setInlineBatchError] = useState<string | null>(null);

  async function openBatchModal(prod: WarehouseProduct) {
    setViewingBatchProduct(prod);
    setLoadingBatches(true);
    setProductBatches([]);
    setInlineBatchEditId(null);
    setInlineBatchExpiry('');
    setInlineBatchError(null);
    try {
      const res = await fetch(`/api/admin/gudang/batch?productId=${prod.id}`);
      const j = await res.json();
      if (j.success && j.data?.batches) {
        setProductBatches(j.data.batches);
      }
    } catch {
      // silent
    } finally {
      setLoadingBatches(false);
    }
  }

  async function handleSaveInlineBatchExpiry(batchId: string) {
    if (!viewingBatchProduct || !canMutateStock) return;
    setSavingInlineBatch(true);
    setInlineBatchError(null);
    try {
      const res = await fetch(`/api/gudang/produk/${viewingBatchProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchUpdates: [{ batchId, expiryDate: inlineBatchExpiry.trim() || null }],
          reason: 'Pembaruan tanggal kedaluwarsa dari Rincian Batch',
        }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        setInlineBatchError(json.error ?? 'Gagal menyimpan tanggal kedaluwarsa.');
        return;
      }
      setInlineBatchEditId(null);
      setInlineBatchExpiry('');
      const [batchRes] = await Promise.all([
        fetch(`/api/admin/gudang/batch?productId=${viewingBatchProduct.id}`),
        loadData(),
      ]);
      const batchJson = await batchRes.json();
      if (batchJson.success && batchJson.data?.batches) {
        setProductBatches(batchJson.data.batches);
      }
    } catch {
      setInlineBatchError('Koneksi terputus saat menyimpan tanggal kedaluwarsa.');
    } finally {
      setSavingInlineBatch(false);
    }
  }

  // State Kamera Scanner
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load Data Awal (dengan In-Memory SWR Cache) ──────────────
  const applyWarehouseData = useCallback(
    (data: WarehousePayloadData, cacheKey?: string) => {
      if (cacheKey) {
        warehouseDataMemCache.set(cacheKey, data);
      }
      setErrorMsg(null);
      setEmployee(data.employee);
      setSummary(data.summary);
      setProducts(data.items);
      setActivities(data.activities);
      if (data.categories) {
        setCategoriesList(data.categories);
      }
      if (data.approvalNotifications) {
        setApprovalNotifs(data.approvalNotifications);
      }
    },
    [],
  );

  const fetchWarehouseData = useCallback(
    async (targetFilter: string, targetSearch: string, signal?: AbortSignal) => {
      const filterParam =
        targetFilter === 'aktivitas' || targetFilter === 'penerimaan' ? 'semua' : targetFilter;
      const res = await fetch(
        `/api/kasir/gudang?filter=${filterParam}&search=${encodeURIComponent(targetSearch)}`,
        { signal },
      );

      if (res.status === 401 || res.status === 403) {
        router.push('/gudang/login');
        return { redirected: true as const };
      }

      const json = (await res.json()) as {
        success: boolean;
        data?: WarehousePayloadData;
        error?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        return {
          redirected: false as const,
          ok: false as const,
          error: json.error ?? 'Gagal memuat data gudang.',
        };
      }

      return { redirected: false as const, ok: true as const, data: json.data };
    },
    [router],
  );

  async function loadData(targetFilter = activeTab, targetSearch = search) {
    const cKey = makeWarehouseCacheKey(targetFilter, targetSearch);
    if (!warehouseDataMemCache.has(cKey)) setLoading(true);
    setErrorMsg(null);
    try {
      const result = await fetchWarehouseData(targetFilter, targetSearch);
      if (result.redirected) return;
      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }
      applyWarehouseData(result.data, cKey);
    } catch {
      setErrorMsg('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  const prevTabRef = useRef(activeTab);
  const lastExecutedSearchRef = useRef(search);

  useEffect(() => {
    const controller = new AbortController();
    const tabChanged = prevTabRef.current !== activeTab;
    const searchChanged = lastExecutedSearchRef.current !== search;
    const delayMs = tabChanged || !searchChanged ? 0 : 300;
    prevTabRef.current = activeTab;
    const cKey = makeWarehouseCacheKey(activeTab, search);

    const timer = setTimeout(() => {
      lastExecutedSearchRef.current = search;
      fetchWarehouseData(activeTab, search, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || result.redirected) return;
          if (!result.ok) {
            setErrorMsg(result.error);
            return;
          }
          applyWarehouseData(result.data, cKey);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setErrorMsg('Gagal terhubung ke server.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, delayMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, search, fetchWarehouseData, applyWarehouseData]);

  // Auto-refresh senyap saat petugas kembali membuka tab Gudang (mis. setelah Manager ACC/Tolak)
  const lastVisibilitySyncRef = useRef<number>(0);
  useEffect(() => {
    const handleVisibilityRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilitySyncRef.current < 8000) return;
      lastVisibilitySyncRef.current = now;
      const cKey = makeWarehouseCacheKey(activeTab, search);
      fetchWarehouseData(activeTab, search)
        .then((result) => {
          if (!result.redirected && result.ok) {
            applyWarehouseData(result.data, cKey);
          }
        })
        .catch(() => {
          // silent background sync
        });
    };

    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('focus', handleVisibilityRefresh);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('focus', handleVisibilityRefresh);
    };
  }, [activeTab, search, fetchWarehouseData, applyWarehouseData]);

  // ── Modal Restock Open Helper ────────────────────────────────
  function openRestockModal(prod: WarehouseProduct) {
    if (!canMutateStock) return;
    setSelectedProduct(prod);
    setRestockQty(1);
    setRestockBonusQty(0);
    setExpiryDate(prod.isPerishable ? getTodayWibStr() : '');
    setBatchCode('');
    setNotes('');
    setRestockSuccessMsg(null);
  }

  function openEditModal(prod: WarehouseProduct) {
    if (!canMutateStock) return;
    setEditingProduct(prod);
    setEditName(prod.name);
    setEditBarcode(prod.barcode ?? '');
    setEditUnit(prod.unit || 'pcs');
    setEditStockQty(prod.stockQty);
    setEditReason('');
    setEditError(null);
    setEditBatches([]);
    setEditSingleExpiryDate(prod.nearestExpiryDate ?? '');
    setLoadingEditBatches(true);

    const seq = ++editFetchSeqRef.current;
    fetch(`/api/admin/gudang/batch?productId=${prod.id}&status=ACTIVE`)
      .then((res) => res.json())
      .then((j: {
        success?: boolean;
        data?: {
          batches?: Array<{
            id: string;
            batchCode: string;
            currentQty: number;
            initialQty: number;
            expiryDate: string | null;
          }>;
        };
      }) => {
        if (editFetchSeqRef.current !== seq) return;
        const rows = (j.success && j.data?.batches ? j.data.batches : []).filter(
          (b) => b.currentQty > 0,
        );
        setEditBatches(
          rows.map((b) => ({
            id: b.id,
            batchCode: b.batchCode,
            currentQty: b.currentQty,
            initialQty: b.initialQty,
            expiryDate: b.expiryDate ?? '',
            originalExpiryDate: b.expiryDate ?? null,
          })),
        );
      })
      .catch(() => {
        if (editFetchSeqRef.current !== seq) return;
        setEditBatches([]);
      })
      .finally(() => {
        if (editFetchSeqRef.current === seq) {
          setLoadingEditBatches(false);
        }
      });
  }

  async function handleEditProductSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProduct || !canMutateStock) return;
    setEditError(null);
    if (!editName.trim() || editName.trim().length < 2) {
      setEditError('Nama produk minimal 2 karakter.');
      return;
    }

    const nextStockQty = Math.max(0, Math.floor(Number(editStockQty)));
    const changedBatchUpdates = editBatches
      .filter((b) => (b.expiryDate.trim() || null) !== b.originalExpiryDate)
      .map((b) => ({
        batchId: b.id,
        expiryDate: b.expiryDate.trim() || null,
      }));

    const payloadBody: Record<string, unknown> = {
      name: editName.trim(),
      barcode: editBarcode.trim() || null,
      unit: editUnit.trim() || 'pcs',
      stockQty: nextStockQty,
      reason: editReason.trim() || undefined,
    };

    if (changedBatchUpdates.length > 0) {
      payloadBody.batchUpdates = changedBatchUpdates;
    } else if (editBatches.length === 0 && nextStockQty > 0 && editSingleExpiryDate.trim()) {
      payloadBody.expiryDate = editSingleExpiryDate.trim();
    }

    setSubmittingEdit(true);
    try {
      const res = await fetch(`/api/gudang/produk/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBody),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        setEditError(json.error ?? 'Gagal menyimpan perubahan produk.');
        return;
      }
      setEditingProduct(null);
      await loadData();
    } catch {
      setEditError('Koneksi terputus saat memperbarui produk.');
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleDeleteProduct(prod: WarehouseProduct) {
    if (!canMutateStock) return;
    const confirmed = window.confirm(
      `Hapus produk "${prod.name}" dari katalog aktif Kasir & Gudang? (Soft-delete, histori transaksi tetap aman.)`,
    );
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/gudang/produk/${prod.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        alert(json.error ?? 'Gagal menghapus produk.');
        return;
      }
      await loadData();
    } catch {
      alert('Koneksi terputus saat menghapus produk.');
    }
  }

  function openNewProductModal() {
    if (!canMutateStock) return;
    setNewProdName('');
    setNewProdCategoryId(categoriesList[0]?.id ?? '');
    setNewProdBarcode('');
    setNewProdUnit('pcs');
    setNewProdCostPrice('0');
    setNewProdSellingPrice('');
    setNewProdInitialQty(1);
    setNewProdExpiryDate(addDaysWibStr(30));
    setNewProdIsPerishable(false);
    setNewProdPerishableType('KONSINYASI');
    setNewProdSupplier('');
    setNewProdNotes('');
    setNewProdError(null);
    setNewProdSuccessMsg(null);
    setShowNewProductModal(true);
  }

  async function handleProposeNewProductSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canMutateStock) return;
    setNewProdError(null);

    const todayStr = getTodayWibStr();
    if (!newProdName.trim() || newProdName.trim().length < 2) {
      setNewProdError('Nama produk/varian wajib diisi minimal 2 karakter.');
      return;
    }
    if (!newProdCategoryId) {
      setNewProdError('Kategori produk wajib dipilih.');
      return;
    }
    const sellNum = Number(newProdSellingPrice);
    const costNum = Number(newProdCostPrice || '0');
    if (!Number.isFinite(sellNum) || sellNum <= 0) {
      setNewProdError('Usulan harga jual wajib lebih dari Rp 0.');
      return;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      setNewProdError('Harga beli (HPP) tidak boleh negatif.');
      return;
    }
    if (!newProdExpiryDate) {
      setNewProdError('Tanggal kedaluwarsa (Expired Date) wajib diisi untuk semua produk baru.');
      return;
    }
    if (newProdExpiryDate < todayStr) {
      setNewProdError(`Tanggal kedaluwarsa (${newProdExpiryDate}) sudah terlewat.`);
      return;
    }

    setSubmittingNewProd(true);
    try {
      const res = await fetch('/api/gudang/produk-baru', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProdName.trim(),
          categoryId: newProdCategoryId,
          barcode: newProdBarcode.trim() || null,
          unit: newProdUnit.trim() || 'pcs',
          costPrice: costNum,
          sellingPrice: sellNum,
          initialQty: Math.max(1, Number(newProdInitialQty)),
          expiryDate: newProdExpiryDate,
          isPerishable: newProdIsPerishable,
          perishableType: newProdPerishableType,
          supplierName: newProdSupplier.trim() || null,
          notes: newProdNotes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: { message?: string };
        error?: string;
      };
      if (!res.ok || !json.success) {
        setNewProdError(json.error ?? 'Gagal mengajukan produk baru.');
        return;
      }

      setNewProdSuccessMsg(
        json.data?.message ??
          `Usulan produk baru "${newProdName.trim()}" berhasil dikirim ke Approval Manager! Produk akan aktif di Kasir setelah di-ACC Manager.`,
      );
      await loadData();
      setTimeout(() => {
        setShowNewProductModal(false);
        setNewProdSuccessMsg(null);
      }, 2200);
    } catch {
      setNewProdError('Koneksi terputus saat mengajukan produk baru.');
    } finally {
      setSubmittingNewProd(false);
    }
  }

  // ── Submit Restock Mutasi Stok (2-Layer Approval untuk Petugas Gudang) ──
  async function handleRestockSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canMutateStock || !selectedProduct || restockQty <= 0) return;

    const todayStr = getTodayWibStr();
    if (!expiryDate) {
      alert('Tanggal kedaluwarsa (Expired Date) wajib diisi untuk semua barang masuk (termasuk makanan harian).');
      return;
    }
    if (expiryDate < todayStr) {
      alert(`Tanggal kedaluwarsa (${expiryDate}) sudah terlewat. Tidak dapat menerima barang kedaluwarsa.`);
      return;
    }

    setSubmittingRestock(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/kasir/gudang', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          qtyAdd: Number(restockQty),
          bonusQty: Math.max(0, Math.floor(Number(restockBonusQty || 0))),
          expiryDate,
          batchCode: batchCode.trim() ? batchCode.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        data?: {
          mode?: 'SUBMITTED_FOR_APPROVAL' | 'APPROVED_DIRECT';
          receiveNumber?: string;
          message?: string;
          qtyBefore: number;
          qtyAfter: number;
          productName: string;
        };
        error?: string;
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? 'Gagal mencatat restock.');
        return;
      }

      if (json.data?.mode === 'SUBMITTED_FOR_APPROVAL') {
        setRestockSuccessMsg(
          json.data.message ??
            `Pengajuan restock +${restockQty} ${selectedProduct.unit} ${selectedProduct.name} (#${json.data.receiveNumber}) berhasil dikirim ke antrian Approval Manager. Stok di Kasir akan bertambah setelah di-ACC Manager.`,
        );
      } else {
        const totalAdded = Number(restockQty) + Math.max(0, Math.floor(Number(restockBonusQty || 0)));
        setRestockSuccessMsg(
          json.data?.message ??
            `Sukses! Stok ${selectedProduct.name} bertambah +${totalAdded} ${selectedProduct.unit}. Total sekarang: ${json.data?.qtyAfter ?? selectedProduct.stockQty + totalAdded} ${selectedProduct.unit}.`,
        );
      }

      // Refresh data di background
      await loadData();

      // Tutup modal setelah delay singkat agar user melihat feedback
      setTimeout(() => {
        setSelectedProduct(null);
        setRestockSuccessMsg(null);
      }, 2000);
    } catch {
      alert('Koneksi terputus saat menyimpan restock.');
    } finally {
      setSubmittingRestock(false);
    }
  }

  // ── Barcode Scanner Kamera Handheld ──────────────────────────
  async function startScanner() {
    setIsScanning(true);
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Kamera tidak didukung pada browser ini.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a'],
          });

          scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                const detectedCode = barcodes[0].rawValue;
                stopScanner();
                setSearch(detectedCode);
              }
            } catch {
              // Abaikan frame drop
            }
          }, 300);
        }
      }
    } catch {
      setCameraError('Izin kamera ditolak atau kamera sedang digunakan aplikasi lain.');
    }
  }

  function stopScanner() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  // ── Logout Handler ───────────────────────────────────────────
  async function handleLogout() {
    if (!window.confirm('Keluar dari Portal Petugas Gudang?')) return;
    const isAdminActor =
      employee?.actorRole === 'MANAGER' || employee?.actorRole === 'ADMIN_SHIFT';
    clearIdleStorage(isAdminActor ? 'admin' : 'gudang');
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: isAdminActor ? 'admin' : 'gudang' }),
      });
    } finally {
      router.push(isAdminActor ? '/login' : '/gudang/login');
    }
  }

  // Hitung notifikasi keputusan Manager yang belum dibaca oleh petugas
  const unreadDecisionNotifs = (approvalNotifs?.recentItems ?? []).filter((n) => {
    if (n.status !== 'REJECTED' && n.status !== 'REVISED' && n.status !== 'APPROVED') return false;
    return new Date(n.updatedAt).getTime() > lastReadNotifTs;
  });
  const urgentUnreadNotifs = unreadDecisionNotifs.filter(
    (n) => n.status === 'REJECTED' || n.status === 'REVISED',
  );

  function markAllNotifsAsRead() {
    const nowTs = Date.now();
    setLastReadNotifTs(nowTs);
    try {
      localStorage.setItem(GUDANG_NOTIF_READ_KEY, String(nowTs));
    } catch {
      // ignore
    }
  }

  function jumpToPenerimaanStatus(
    targetStatus: 'semua' | 'draft' | 'submitted' | 'revised' | 'approved' | 'rejected',
  ) {
    setPenerimaanTargetFilter(targetStatus);
    setPenerimaanJumpSeq((s) => s + 1);
    setActiveTab('penerimaan');
    setShowNotifModal(false);
    markAllNotifsAsRead();
  }

  return (
    <div
      style={{
        minHeight: '100svh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'inherit',
        paddingBottom: 80,
      }}
    >
      {employee && (
        <IdleTimeoutGuard
          policy={getWarehouseIdleTimeoutPolicy(employee.actorRole ?? 'EMPLOYEE')}
          sessionIssuedAtMs={employee.sessionIssuedAtMs}
        />
      )}
      {/* ── TOP APP BAR (MOBILE FRIENDLY) ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)',
          padding: '12px 16px',
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 auto' }}>
            <div
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: 10,
                backgroundColor: 'hsl(217 91% 60%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 2px 6px -1px hsl(217 91% 60% / 0.4)',
              }}
            >
              <Package size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, lineHeight: 1.2, color: '#0f172a' }}>
                Wiramart Gudang
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    flexShrink: 0,
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {employee ? `${employee.name} (${employee.jabatan || 'Gudang'})` : 'Memuat sesi...'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {employee &&
              (employee.actorRole === 'MANAGER' ||
                employee.actorRole === 'ADMIN_SHIFT' ||
                employee.jabatan?.toLowerCase().includes('admin') ||
                employee.jabatan?.toLowerCase().includes('manager')) && (
              <button
                type="button"
                onClick={() => router.push(getDashboardPathForRole(employee.actorRole))}
                className="btn btn-secondary"
                style={{
                  minHeight: 44,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#0f172a',
                  fontWeight: 600,
                }}
                title="Kembali ke Dashboard Admin"
              >
                <ChevronLeft size={14} />
                <span>Dashboard</span>
              </button>
            )}
            {/* Tombol Lonceng Notifikasi Keputusan Manager */}
            <button
              type="button"
              onClick={() => setShowNotifModal(true)}
              className="btn btn-secondary"
              style={{
                position: 'relative',
                minWidth: 44,
                minHeight: 44,
                padding: 0,
                borderRadius: 8,
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border:
                  urgentUnreadNotifs.length > 0
                    ? '1.5px solid #ef4444'
                    : unreadDecisionNotifs.length > 0
                    ? '1.5px solid #22c55e'
                    : '1px solid #cbd5e1',
                background:
                  urgentUnreadNotifs.length > 0
                    ? '#fef2f2'
                    : unreadDecisionNotifs.length > 0
                    ? '#f0fdf4'
                    : '#fff',
                color:
                  urgentUnreadNotifs.length > 0
                    ? '#dc2626'
                    : unreadDecisionNotifs.length > 0
                    ? '#16a34a'
                    : '#475569',
              }}
              aria-label="Notifikasi Keputusan Manager"
              title="Notifikasi Keputusan Manager (ACC / Revisi / Ditolak)"
            >
              <Bell size={17} />
              {unreadDecisionNotifs.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    minWidth: 19,
                    height: 19,
                    padding: '0 5px',
                    borderRadius: 999,
                    backgroundColor: urgentUnreadNotifs.length > 0 ? '#dc2626' : '#16a34a',
                    color: '#ffffff',
                    fontSize: '0.68rem',
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  }}
                >
                  {unreadDecisionNotifs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => loadData()}
              className="btn btn-secondary"
              style={{
                minWidth: 44,
                minHeight: 44,
                padding: 0,
                borderRadius: 8,
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#475569',
              }}
              aria-label="Segarkan Data"
              title="Segarkan Data"
            >
              <RefreshCw size={16} className={loading ? 'spin-icon' : ''} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{
                minWidth: 44,
                minHeight: 44,
                padding: 0,
                borderRadius: 8,
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#ef4444',
              }}
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── KONTEN UTAMA ── */}
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '16px 14px' }}>
        {/* ── BANNER NOTIFIKASI KEPUTUSAN MANAGER (DITOLAK / PERLU REVISI) ── */}
        {urgentUnreadNotifs.length > 0 && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '12px 14px',
              borderRadius: 12,
              border:
                urgentUnreadNotifs[0].status === 'REJECTED'
                  ? '1.5px solid #ef4444'
                  : '1.5px solid #f97316',
              backgroundColor:
                urgentUnreadNotifs[0].status === 'REJECTED' ? '#fef2f2' : '#fff7ed',
              color:
                urgentUnreadNotifs[0].status === 'REJECTED' ? '#991b1b' : '#9a3412',
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {urgentUnreadNotifs[0].status === 'REJECTED' ? (
                  <XCircle size={20} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                ) : (
                  <AlertTriangle size={20} style={{ color: '#ea580c', flexShrink: 0, marginTop: 1 }} />
                )}
                <div style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 800 }}>
                    {urgentUnreadNotifs[0].status === 'REJECTED'
                      ? `Usulan #${urgentUnreadNotifs[0].receiveNumber} DITOLAK oleh Manager`
                      : `Usulan #${urgentUnreadNotifs[0].receiveNumber} PERLU REVISI dari Manager`}
                    {urgentUnreadNotifs.length > 1 && ` (+${urgentUnreadNotifs.length - 1} lainnya)`}
                  </div>
                  <div style={{ fontSize: '0.76rem', marginTop: 2 }}>
                    <strong>Item:</strong> {urgentUnreadNotifs[0].productSummary}
                  </div>
                  {urgentUnreadNotifs[0].managerNote && (
                    <div
                      style={{
                        marginTop: 4,
                        padding: '6px 9px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(255,255,255,0.75)',
                        border: '1px solid rgba(220, 38, 38, 0.2)',
                        fontSize: '0.78rem',
                      }}
                    >
                      <strong>Alasan / Catatan Manager:</strong> &ldquo;{urgentUnreadNotifs[0].managerNote}&rdquo;
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={markAllNotifsAsRead}
                aria-label="Tandai notifikasi sudah dibaca"
                title="Tandai sudah dibaca"
                style={{
                  background: 'rgba(255,255,255,0.7)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 6,
                  color: 'inherit',
                  padding: '4px 6px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 30 }}>
              <button
                type="button"
                onClick={() =>
                  jumpToPenerimaanStatus(
                    urgentUnreadNotifs[0].status === 'REJECTED' ? 'rejected' : 'revised',
                  )
                }
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor:
                    urgentUnreadNotifs[0].status === 'REJECTED' ? '#dc2626' : '#ea580c',
                  color: '#ffffff',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {urgentUnreadNotifs[0].status === 'REJECTED'
                  ? 'Lihat di Tab Ditolak →'
                  : 'Perbaiki di Tab Perlu Revisi →'}
              </button>
              <button
                type="button"
                onClick={() => setShowNotifModal(true)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid currentColor',
                  backgroundColor: '#ffffff',
                  color: 'inherit',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Lihat Semua Notifikasi ({approvalNotifs?.recentItems.length ?? 0})
              </button>
            </div>
          </div>
        )}
        {isReadOnlyAdminShift && (
          <div
            role="status"
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid hsl(217 91% 60% / 0.35)',
              backgroundColor: 'hsl(217 91% 60% / 0.08)',
              color: 'hsl(221 83% 35%)',
              fontSize: '0.78rem',
              lineHeight: 1.45,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Portal Gudang & Nota Supplier (Admin Shift):</strong> Anda dapat mengunggah foto nota & melihat Tabel Buku Nota di tab <strong>Faktur Pemasok &amp; Penerimaan</strong>, serta memantau stok kritis dan batch FEFO.
            </div>
          </div>
        )}

        {/* KPI DASHBOARD CARDS (HEALTH BAR) */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {/* Card 1: Stok Habis */}
          <button
            type="button"
            onClick={() => setActiveTab('habis')}
            style={{
              textAlign: 'left',
              padding: '12px 10px',
              borderRadius: 12,
              minHeight: 80,
              backgroundColor: activeTab === 'habis' ? '#fee2e2' : '#ffffff',
              border: activeTab === 'habis' ? '1.5px solid #ef4444' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase' }}>
              Habis
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#991b1b', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.outOfStockSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>0 Pcs</div>
          </button>

          {/* Card 2: Stok Kritis */}
          <button
            type="button"
            onClick={() => setActiveTab('kritis')}
            style={{
              textAlign: 'left',
              padding: '12px 10px',
              borderRadius: 12,
              minHeight: 80,
              backgroundColor: activeTab === 'kritis' ? '#fef3c7' : '#ffffff',
              border: activeTab === 'kritis' ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>
              Kritis
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#b45309', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.lowStockSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>&le; {lowStockThreshold} Pcs</div>
          </button>

          {/* Card 3: FEFO Mendekati Expired */}
          <button
            type="button"
            onClick={() => setActiveTab('fefo')}
            style={{
              textAlign: 'left',
              padding: '12px 10px',
              borderRadius: 12,
              minHeight: 80,
              backgroundColor: activeTab === 'fefo' ? '#ffedd5' : '#ffffff',
              border: activeTab === 'fefo' ? '1.5px solid #f97316' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ea580c', textTransform: 'uppercase' }}>
              FEFO Exp
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#c2410c', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.expiringSoonSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>&le; 7 Hari / Exp</div>
          </button>

          {/* Card 4: Restock Hari Ini */}
          <button
            type="button"
            onClick={() => setActiveTab('aktivitas')}
            style={{
              textAlign: 'left',
              padding: '12px 10px',
              borderRadius: 12,
              minHeight: 80,
              backgroundColor: activeTab === 'aktivitas' ? '#dcfce7' : '#ffffff',
              border: activeTab === 'aktivitas' ? '1.5px solid #22c55e' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase' }}>
              Restock
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.todayRestockCount : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>Hari Ini</div>
          </button>
        </section>

        {/* ── BAR PENCARIAN, SCANNER KAMERA & USULAN PRODUK BARU ── */}
        <section style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ position: 'relative', flex: '1 1 220px' }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              />
              <input
                id={searchInputId}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama produk / scan barcode..."
                style={{
                  width: '100%',
                  minHeight: 44,
                  height: 'auto',
                  paddingLeft: 36,
                  paddingRight: search ? 46 : 12,
                  paddingTop: 10,
                  paddingBottom: 10,
                  borderRadius: 10,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '1rem',
                  outline: 'none',
                  boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 2,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    minWidth: 44,
                    minHeight: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                  aria-label="Hapus pencarian"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={startScanner}
              className="btn btn-primary"
              style={{
                minHeight: 44,
                height: 44,
                padding: '0 14px',
                borderRadius: 10,
                backgroundColor: 'hsl(217 91% 60%)',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px -1px hsl(217 91% 60% / 0.4)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Camera size={16} />
              <span>Scan Kamera</span>
            </button>

            {canMutateStock && (
              <button
                type="button"
                onClick={openNewProductModal}
                className="btn btn-primary"
                style={{
                  minHeight: 44,
                  height: 44,
                  padding: '0 14px',
                  borderRadius: 10,
                  backgroundColor: '#059669',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 6px -1px rgba(5, 150, 105, 0.38)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={16} />
                <span>Tambah Produk Baru</span>
              </button>
            )}
          </div>
        </section>

        {/* ── FILTER PILLS TABS ── */}
        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            paddingBottom: 6,
            marginBottom: 12,
          }}
        >
          {[
            { id: 'semua', label: summary ? `Seluruh Produk (${summary.totalSku})` : 'Seluruh Produk' },
            {
              id: 'penerimaan',
              label:
                approvalNotifs && (approvalNotifs.rejectedCount > 0 || approvalNotifs.revisedCount > 0)
                  ? `Faktur Pemasok & Penerimaan (${approvalNotifs.rejectedCount + approvalNotifs.revisedCount} Info)`
                  : approvalNotifs && approvalNotifs.pendingCount > 0
                  ? `Faktur Pemasok & Penerimaan (${approvalNotifs.pendingCount} Menunggu)`
                  : 'Faktur Pemasok & Penerimaan',
            },
            {
              id: 'fefo',
              label: summary
                ? `${isReadOnlyAdminShift ? 'Pemantauan FEFO' : 'Tindakan FEFO & Diskon'} (${summary.expiringSoonSku})`
                : isReadOnlyAdminShift
                ? 'Pemantauan FEFO'
                : 'Tindakan FEFO & Diskon',
            },
            { id: 'kritis', label: summary ? `Stok Menipis (${summary.lowStockSku})` : 'Stok Menipis' },
            { id: 'perishable', label: summary?.perishableSku !== undefined ? `Produk Konsumsi Harian (${summary.perishableSku})` : 'Produk Konsumsi Harian' },
            { id: 'habis', label: summary ? `Stok Habis (${summary.outOfStockSku})` : 'Stok Habis' },
            { id: 'aktivitas', label: summary ? `Riwayat Penambahan Stok (${summary.todayRestockCount})` : 'Riwayat Penambahan Stok' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id as typeof activeTab)}
                style={{
                  minHeight: 44,
                  padding: '8px 14px',
                  borderRadius: 22,
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  border: isActive ? '1px solid hsl(217 91% 60%)' : '1px solid #cbd5e1',
                  backgroundColor: isActive ? 'hsl(217 91% 95%)' : '#ffffff',
                  color: isActive ? 'hsl(217 91% 35%)' : '#475569',
                  transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </section>

        {/* ── ERROR ALERT JIKA ADA ── */}
        {errorMsg && (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: '#fee2e2',
              border: '1px solid #ef4444',
              borderRadius: 10,
              color: '#991b1b',
              fontSize: '0.8rem',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── TAB KONTEN: RIWAYAT / PENERIMAAN / PRODUK ── */}
        {activeTab === 'aktivitas' ? (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                Riwayat Restock Gudang Terbaru
              </h2>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {summary ? `${summary.todayRestockCount} hari ini · ` : ''}{activities.length} log terbaru
              </span>
            </div>

            {activities.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                }}
              >
                <History size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Belum ada riwayat restock</div>
                <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  Barang yang direstock oleh petugas gudang akan otomatis tercatat di sini.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activities.map((act) => {
                  const dateStr = act.formattedDate || new Date(act.createdAt).toLocaleDateString('id-ID', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'Asia/Jakarta',
                  });
                  const timeStr = act.formattedTime || `${new Date(act.createdAt).toLocaleTimeString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    hour: '2-digit',
                    minute: '2-digit',
                  })} WIB`;

                  return (
                    <div
                      key={act.id}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Baris 1: Nama Produk & Badge Qty */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                            {act.productName}
                          </div>
                          {act.categoryName && (
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                              Kategori: {act.categoryName}
                            </div>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: 900,
                            padding: '4px 10px',
                            borderRadius: 8,
                            backgroundColor: '#dcfce7',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                            flexShrink: 0,
                          }}
                        >
                          +{act.qtyDiff} Pcs
                        </span>
                      </div>

                      {/* Baris 2: Waktu Lengkap & Shift */}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: '0.73rem',
                          color: '#334155',
                          backgroundColor: '#f8fafc',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Calendar size={13} style={{ color: '#0284c7' }} />
                          <span><strong>{dateStr}</strong></span>
                        </div>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={13} style={{ color: '#f59e0b' }} />
                          <span>{timeStr}</span>
                        </div>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                          <Layers size={13} style={{ color: '#8b5cf6' }} />
                          <span>{act.shiftInfo || 'Shift Reguler Toko'}</span>
                        </div>
                      </div>

                      {/* Baris 3: Petugas & Batch Info */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: '0.72rem', color: '#64748b' }}>
                        <div>
                          <strong>Petugas:</strong> {act.actorName ? `${act.actorName} (${act.actorNim || 'Gudang'})` : 'Petugas Toko'}
                        </div>
                        {act.batchCode && (
                          <div>
                            <strong>Batch:</strong> <code style={{ backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: 4, color: '#0f172a' }}>{act.batchCode}</code>
                          </div>
                        )}
                        {act.expiryDate && (
                          <div style={{ color: '#c2410c' }}>
                            <strong>Exp:</strong> {act.expiryDate}
                          </div>
                        )}
                      </div>

                      {/* Catatan jika ada */}
                      {act.notes && (
                        <div style={{ fontSize: '0.72rem', color: '#475569', fontStyle: 'italic', borderLeft: '2px solid #cbd5e1', paddingLeft: 8 }}>
                          &ldquo;{act.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : activeTab === 'penerimaan' ? (
          <PenerimaanBarangSection
            key={`${penerimaanTargetFilter ?? 'semua'}-${penerimaanJumpSeq}`}
            productsList={products.map((p) => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              categoryName: p.categoryName,
              stockQty: p.stockQty,
              unit: p.unit,
              isPerishable: p.isPerishable,
            }))}
            initialStatusFilter={penerimaanTargetFilter}
            onDraftApproved={() => loadData(activeTab, search)}
          />
        ) : activeTab === 'fefo' && !isReadOnlyAdminShift ? (
          <FEFOActionSection onBadgeUpdate={() => loadData(activeTab, search)} />
        ) : (
          /* ── TAB KONTEN 2: LIST PRODUK GUDANG & RADAR FEFO ── */
          <section>
            {/* ── CARD EDUKASI Makanan Harian (PERISHABLE) ── */}
            {activeTab === 'perishable' && (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #fed7aa',
                  padding: '14px 16px',
                  marginBottom: 16,
                  boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Sparkles size={18} style={{ color: '#ea580c' }} />
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#9a3412', margin: 0 }}>
                    Sistem Pemantauan Kedaluwarsa Wiramart (2 Tipe Produk)
                  </h3>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 10,
                    fontSize: '0.74rem',
                    color: '#475569',
                  }}
                >
                  {/* Tipe 1: Produk Pabrik Ber-Barcode */}
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                    }}
                    onClick={() => setActiveTab('fefo')}
                  >
                    <div style={{ fontWeight: 800, color: '#c2410c', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>Tipe 1: Produk Kemasan Ber-Barcode (FEFO)</span>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.45 }}>
                      <strong>Sistem FEFO:</strong> Minuman botol (Ades, Sprite), susu, biskuit, snack pabrik. Tanggal expired dicatat per batch dus masuk dan dipantau 7 s/d 30 hari sebelum kedaluwarsa. Produk kedaluwarsa terdekat wajib ditempatkan paling depan rak.
                    </p>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#ea580c', fontWeight: 700 }}>
                      &bull; {summary ? `${summary.expiringSoonSku} batch mendekati expired` : 'Dipantau otomatis'}
                    </div>
                  </div>

                  {/* Tipe 2: Makanan Harian Non-Barcode */}
                  <div
                    style={{
                      backgroundColor: activeTab === 'perishable' ? '#f0fdf4' : '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: activeTab === 'perishable' ? '1.5px solid #22c55e' : '1px solid #e2e8f0',
                      cursor: 'pointer',
                    }}
                    onClick={() => setActiveTab('perishable')}
                  >
                    <div style={{ fontWeight: 800, color: '#15803d', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>Tipe 2: Makanan Harian (Wajib Habis 1 Hari)</span>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.45 }}>
                      <strong>Batas Konsumsi 1 Hari (Cut-off Pukul 15:00 WIB):</strong> Nasi bungkus, risol, donat, cilok, kue tradisional, dan makanan titipan harian. <em>Wajib habis di hari yang sama</em>. Pukul 15:00 WIB wajib dilakukan cut-off sisa (retur/obral) dan stok sisa otomatis di-reset menjadi 0 saat pergantian hari.
                    </p>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>
                      &bull; {summary ? `${summary.perishableSku ?? 0} item Makanan Harian terdaftar` : 'Wajib Cut-Off Jam 15:00'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                {activeTab === 'perishable'
                  ? 'Daftar Makanan Harian (Wajib Habis 1 Hari / Cut-off 15:00 WIB)'
                  : activeTab === 'fefo'
                  ? 'Radar Produk FEFO Mendekati Kedaluwarsa (Read-Only)'
                  : activeTab === 'kritis'
                  ? `Daftar Stok Kritis (≤ ${lowStockThreshold} Pcs)`
                  : activeTab === 'habis'
                  ? 'Daftar Stok Habis (0 Pcs)'
                  : 'Daftar Inventaris Produk'}
              </h2>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {search.trim() ? `${products.length} hasil untuk "${search.trim()}"` : `${products.length} produk ditemukan`}
              </span>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
                <RefreshCw size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '0.8rem' }}>Memuat status stok produk...</div>
              </div>
            ) : products.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                }}
              >
                <Package size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {search.trim()
                    ? `Tidak ada produk "${search.trim()}" pada filter ${activeTab === 'habis' ? 'Stok Habis' : activeTab === 'kritis' ? 'Stok Kritis' : 'ini'}`
                    : 'Tidak ada produk yang cocok'}
                </div>
                <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  {search.trim() && activeTab !== 'semua'
                    ? 'Produk mungkin masih memiliki stok aman. Coba cari di Semua Produk.'
                    : 'Coba ubah kata kunci pencarian atau ganti filter.'}
                </div>
                {search.trim() && activeTab !== 'semua' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('semua')}
                    style={{
                      marginTop: 10,
                      minHeight: 44,
                      padding: '10px 16px',
                      borderRadius: 8,
                      backgroundColor: 'hsl(217 91% 60%)',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cari &ldquo;{search.trim()}&rdquo; di Semua Produk
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {products.map((item) => {
                  const isZero = item.stockQty <= 0;
                  const isLow = !isZero && item.stockQty <= lowStockThreshold;

                  return (
                    <div
                      key={item.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        border: isZero
                          ? '1px solid #fca5a5'
                          : isLow
                          ? '1px solid #fcd34d'
                          : '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Baris 1: Nama, Kategori, Badge Perishable */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                              {item.name}
                            </span>
                            {item.isPerishable && (
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  backgroundColor: 'hsl(38 92% 92%)',
                                  color: 'hsl(38 92% 35%)',
                                }}
                              >
                                {item.perishableType === 'BELI_LEPAS' ? 'Modal Toko' : 'Konsinyasi'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                            {item.categoryName} &bull; Barcode: {item.barcode || 'Non-barcode'}
                          </div>
                        </div>

                        {/* Indikator Stok Badge */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '0.85rem',
                              fontWeight: 900,
                              padding: '2px 8px',
                              borderRadius: 6,
                              backgroundColor: isZero ? '#fee2e2' : isLow ? '#fef3c7' : '#dcfce7',
                              color: isZero ? '#ef4444' : isLow ? '#b45309' : '#15803d',
                            }}
                          >
                            {item.stockQty} {item.unit}
                          </span>
                          <div
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              color: isZero ? '#ef4444' : isLow ? '#d97706' : '#16a34a',
                              marginTop: 2,
                            }}
                          >
                            {isZero ? 'HABIS' : isLow ? 'KRITIS' : 'AMAN'}
                          </div>
                        </div>
                      </div>

                      {/* Baris 2: Radar Kedaluwarsa FEFO */}
                      {item.nearestExpiryDate ? (
                        <div
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '0.72rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor:
                              item.expiryUrgency === 'EXPIRED'
                                ? '#fee2e2'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '#ffedd5'
                                : item.expiryUrgency === 'WARNING'
                                ? '#fef9c3'
                                : '#f1f5f9',
                            color:
                              item.expiryUrgency === 'EXPIRED'
                                ? '#991b1b'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '#c2410c'
                                : item.expiryUrgency === 'WARNING'
                                ? '#854d0e'
                                : '#475569',
                            border:
                              item.expiryUrgency === 'EXPIRED'
                                ? '1px solid #f87171'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '1px solid #fb923c'
                                : '1px solid #e2e8f0',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                            <Clock size={13} />
                            <span>
                              Exp Terdekat: <strong>{item.nearestExpiryDate}</strong>
                            </span>
                          </div>
                          <span style={{ fontWeight: 800, fontSize: '0.68rem' }}>
                            {item.expiryUrgency === 'EXPIRED'
                              ? 'SUDAH EXPIRED'
                              : item.expiryUrgency === 'CRITICAL'
                              ? '< 7 HARI (FEFO)'
                              : item.expiryUrgency === 'WARNING'
                              ? '< 30 HARI'
                              : 'AMAN'}
                          </span>
                        </div>
                      ) : item.stockQty > 0 ? (
                        <div
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '0.72rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            backgroundColor: '#fffbeb',
                            color: '#92400e',
                            border: '1px dashed #fcd34d',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                            <Clock size={13} />
                            <span>Tanggal Expired belum diisi</span>
                          </div>
                          {canMutateStock && (
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: '1px solid #f59e0b',
                                backgroundColor: '#ffffff',
                                color: '#b45309',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Isi Exp
                            </button>
                          )}
                        </div>
                      ) : null}

                      {/* Baris 3: Tombol Aksi Restock & Rincian Batch FEFO */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openBatchModal(item)}
                          className="btn btn-secondary"
                          style={{
                            minHeight: 44,
                            padding: '10px 14px',
                            borderRadius: 8,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            backgroundColor: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            color: '#334155',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            cursor: 'pointer',
                          }}
                        >
                          <Boxes size={14} />
                          <span>Rincian Batch ({item.activeBatchesCount})</span>
                        </button>
                        {canMutateStock && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              style={{
                                minHeight: 44,
                                padding: '10px 12px',
                                borderRadius: 8,
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                backgroundColor: '#ffffff',
                                border: '1px solid #cbd5e1',
                                color: '#334155',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                cursor: 'pointer',
                              }}
                              title="Edit nama, barcode, atau stok produk"
                            >
                              <Pencil size={14} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(item)}
                              style={{
                                minHeight: 44,
                                padding: '10px 12px',
                                borderRadius: 8,
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                backgroundColor: '#fef2f2',
                                border: '1px solid #fecaca',
                                color: '#b91c1c',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                cursor: 'pointer',
                              }}
                              title="Hapus produk dari katalog aktif"
                            >
                              <Trash2 size={14} />
                              <span>Hapus</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openRestockModal(item)}
                              className="btn btn-primary"
                              style={{
                                minHeight: 44,
                                padding: '10px 14px',
                                borderRadius: 8,
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                backgroundColor: 'hsl(217 91% 60%)',
                                color: '#fff',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                cursor: 'pointer',
                              }}
                            >
                              <Plus size={14} />
                              <span>Restock / Barang Masuk</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* ── MODAL RINCIAN MULTI-BATCH FEFO ── */}
      {viewingBatchProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            backgroundColor: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 580,
              maxHeight: '90dvh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                backgroundColor: '#f8fafc',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    flexShrink: 0,
                    borderRadius: 10,
                    backgroundColor: 'hsl(142 71% 45% / 0.15)',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Boxes size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                    Pelacakan Multi-Batch &amp; FEFO
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>
                    {viewingBatchProduct.name} &bull; Total Stok Rak: <strong>{viewingBatchProduct.stockQty} {viewingBatchProduct.unit}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingBatchProduct(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  flexShrink: 0,
                  borderRadius: 8,
                }}
                aria-label="Tutup modal batch"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '16px 20px' }}>
              {loadingBatches ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                  Memuat data batch stok...
                </div>
              ) : productBatches.length === 0 ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                  Belum ada riwayat batch terdaftar untuk produk ini.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>
                    Urutan batch di bawah ini disusun otomatis berdasarkan tanggal kedaluwarsa terdekat (First Expired, First Out). Kasir POS akan memotong batch prioritas pertama terlebih dahulu.
                  </div>

                  {productBatches.map((b, idx) => {
                    const isFirstActive = idx === productBatches.findIndex((x) => x.currentQty > 0);
                    const isExpired = b.expiryStatus === 'EXPIRED';
                    const isCritical = b.expiryStatus === 'CRITICAL_7';

                    return (
                      <div
                        key={b.id}
                        style={{
                          border: isFirstActive
                            ? '2px solid #86efac'
                            : isExpired
                            ? '1px solid #fca5a5'
                            : '1px solid #e2e8f0',
                          backgroundColor: isFirstActive
                            ? '#f0fdf4'
                            : isExpired
                            ? '#fef2f2'
                            : '#ffffff',
                          borderRadius: 12,
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
                                #{b.batchCode}
                              </span>
                              {isFirstActive ? (
                                <span
                                  style={{
                                    backgroundColor: '#dcfce7',
                                    color: '#15803d',
                                    border: '1px solid #86efac',
                                    borderRadius: 4,
                                    fontSize: '0.68rem',
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                  }}
                                >
                                  PRIORITAS 1 (KELUAR DULUAN)
                                </span>
                              ) : b.currentQty > 0 ? (
                                <span
                                  style={{
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 4,
                                    fontSize: '0.68rem',
                                    fontWeight: 600,
                                    padding: '1px 6px',
                                  }}
                                >
                                  Batch Cadangan (Exp Lebih Panjang)
                                </span>
                              ) : (
                                <span
                                  style={{
                                    backgroundColor: '#f8fafc',
                                    color: '#94a3b8',
                                    borderRadius: 4,
                                    fontSize: '0.68rem',
                                    padding: '1px 6px',
                                  }}
                                >
                                  Habis
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                              Diterima: {new Date(b.receivedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: b.currentQty > 0 ? '#0f172a' : '#94a3b8' }}>
                              Sisa: {b.currentQty} / {b.initialQty} {viewingBatchProduct.unit}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 8,
                            borderTop: '1px dashed #e2e8f0',
                            paddingTop: 6,
                            marginTop: 2,
                            fontSize: '0.75rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Clock size={12} style={{ color: '#64748b' }} />
                            <span>
                              Exp:{' '}
                              <strong>
                                {b.expiryDate
                                  ? new Date(b.expiryDate + 'T00:00:00Z').toLocaleDateString('id-ID', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                  : 'Belum diisi'}
                              </strong>
                            </span>
                            {b.currentQty > 0 && canMutateStock && inlineBatchEditId !== b.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setInlineBatchEditId(b.id);
                                  setInlineBatchExpiry(b.expiryDate ?? '');
                                  setInlineBatchError(null);
                                }}
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#ffffff',
                                  color: '#2563eb',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {b.expiryDate ? 'Ubah Exp' : 'Isi Exp'}
                              </button>
                            )}
                          </div>
                          <div>
                            {isExpired ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                  Kedaluwarsa ({Math.abs(b.daysRemaining || 0)} hr lalu)
                                </span>
                                {b.currentQty > 0 && canMutateStock && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const prodName = viewingBatchProduct?.name || '';
                                      setViewingBatchProduct(null);
                                      setSearch(prodName);
                                      setActiveTab('fefo');
                                    }}
                                    style={{
                                      padding: '4px 10px',
                                      borderRadius: 6,
                                      border: '1px solid #ef4444',
                                      background: '#dc2626',
                                      color: '#ffffff',
                                      fontSize: '0.72rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Tarik / Musnahkan di Tab FEFO
                                  </button>
                                )}
                              </div>
                            ) : isCritical ? (
                              <span style={{ color: '#d97706', fontWeight: 700 }}>
                                Sisa {b.daysRemaining} hari (FEFO Kritis)
                              </span>
                            ) : b.expiryStatus === 'WARNING_30' ? (
                              <span style={{ color: '#b45309', fontWeight: 700 }}>
                                Sisa {b.daysRemaining} hari (&lt; 30 hr)
                              </span>
                            ) : b.expiryStatus === 'NO_EXPIRY' || !b.expiryDate ? (
                              <span style={{ color: '#b45309', fontWeight: 700 }}>
                                Exp belum diisi
                              </span>
                            ) : (
                              <span style={{ color: '#16a34a', fontWeight: 600 }}>
                                Aman ({b.daysRemaining} hr)
                              </span>
                            )}
                          </div>
                        </div>

                        {inlineBatchEditId === b.id && canMutateStock && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: '8px 10px',
                              borderRadius: 8,
                              backgroundColor: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155' }}>
                                Atur Tanggal Expired Batch #{b.batchCode}
                              </span>
                              <div style={{ display: 'inline-flex', gap: 4 }}>
                                {[
                                  { d: 0, label: 'Hari Ini' },
                                  { d: 30, label: '+30h' },
                                  { d: 180, label: '+6bln' },
                                  { d: 365, label: '+1th' },
                                ].map(({ d, label }) => (
                                  <button
                                    key={d}
                                    type="button"
                                    onClick={() => setInlineBatchExpiry(addDaysWibStr(d))}
                                    style={{
                                      border: '1px solid #cbd5e1',
                                      backgroundColor: '#ffffff',
                                      color: '#334155',
                                      fontSize: '0.66rem',
                                      fontWeight: 700,
                                      padding: '2px 6px',
                                      borderRadius: 5,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                type="date"
                                value={inlineBatchExpiry}
                                onChange={(e) => setInlineBatchExpiry(e.target.value)}
                                style={{
                                  flex: '1 1 160px',
                                  minHeight: 38,
                                  padding: '6px 10px',
                                  borderRadius: 7,
                                  border: '1px solid #94a3b8',
                                  fontSize: '0.88rem',
                                  backgroundColor: '#ffffff',
                                }}
                              />
                              <button
                                type="button"
                                disabled={savingInlineBatch}
                                onClick={() => handleSaveInlineBatchExpiry(b.id)}
                                style={{
                                  minHeight: 38,
                                  padding: '6px 12px',
                                  borderRadius: 7,
                                  border: 'none',
                                  backgroundColor: '#2563eb',
                                  color: '#ffffff',
                                  fontSize: '0.76rem',
                                  fontWeight: 700,
                                  cursor: savingInlineBatch ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {savingInlineBatch ? 'Menyimpan...' : 'Simpan Exp'}
                              </button>
                              <button
                                type="button"
                                disabled={savingInlineBatch}
                                onClick={() => {
                                  setInlineBatchEditId(null);
                                  setInlineBatchError(null);
                                }}
                                style={{
                                  minHeight: 38,
                                  padding: '6px 10px',
                                  borderRadius: 7,
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#ffffff',
                                  color: '#475569',
                                  fontSize: '0.76rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Batal
                              </button>
                            </div>
                            {inlineBatchExpiry && inlineBatchExpiry < getTodayWibStr() && (
                              <div style={{ fontSize: '0.68rem', color: '#b91c1c', fontWeight: 600 }}>
                                Perhatian: Tanggal ini sudah lewat — batch akan otomatis ditandai EXPIRED di Radar FEFO.
                              </div>
                            )}
                            {inlineBatchError && (
                              <div style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 700 }}>
                                {inlineBatchError}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                display: 'flex',
                justifyContent: 'flex-end',
                borderBottomLeftRadius: 16,
                borderBottomRightRadius: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setViewingBatchProduct(null)}
                style={{
                  minHeight: 44,
                  padding: '10px 20px',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  backgroundColor: '#e2e8f0',
                  color: '#1e293b',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL RESTOCK / INBOUND BARANG MASUK ── */}
      {canMutateStock && selectedProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: '20px 18px calc(20px + env(safe-area-inset-bottom, 0px))',
              boxShadow: '0 -4px 16px rgb(0 0 0 / 0.15)',
              maxHeight: '90dvh',
              overflowY: 'auto',
              animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Header Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    borderRadius: 8,
                    backgroundColor: 'hsl(217 91% 95%)',
                    color: 'hsl(217 91% 40%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Plus size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                    Input Restock / Barang Masuk Langsung
                  </h3>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Tercatat atas nama: {employee?.name || 'Petugas Gudang'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  flexShrink: 0,
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
                aria-label="Tutup modal restock"
              >
                <X size={20} />
              </button>
            </div>

            {/* Info Produk Terpilih */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                {selectedProduct.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                Barcode: {selectedProduct.barcode || 'Non-barcode'} &bull; Stok Sekarang:{' '}
                <strong>
                  {selectedProduct.stockQty} {selectedProduct.unit}
                </strong>
              </div>
            </div>

            {/* Info Restock Langsung & Tanggal Expired Wajib */}
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                backgroundColor: '#f0fdf4',
                border: '1px solid #86efac',
                color: '#166534',
                fontSize: '0.74rem',
                fontWeight: 600,
                marginBottom: 12,
                lineHeight: 1.45,
              }}
            >
              <strong>Restok Langsung Aktif:</strong> Stok langsung masuk ke Kasir & Gudang beserta jejak audit. Keputusan diskon FEFO & keuangan tetap memerlukan persetujuan Manager.
            </div>

            {/* Feedback Sukses */}
            {restockSuccessMsg ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: 10,
                  backgroundColor: '#dcfce7',
                  border: '1px solid #22c55e',
                  color: '#15803d',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckCircle2 size={18} />
                <span>{restockSuccessMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleRestockSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Input Qty Masuk */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Jumlah Barang Masuk ({selectedProduct.unit}) <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setRestockQty((prev) => Math.max(1, prev - 1))}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f1f5f9',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={restockQty}
                      onChange={(e) => setRestockQty(Math.max(1, Number(e.target.value)))}
                      style={{
                        flex: 1,
                        height: 44,
                        textAlign: 'center',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        fontSize: '1.1rem',
                        fontWeight: 800,
                      }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setRestockQty((prev) => prev + 1)}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f1f5f9',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Tombol Cepat Tambah */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {[5, 10, 24, 48].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRestockQty(n)}
                        style={{
                          minHeight: 44,
                          minWidth: 56,
                          padding: '8px 12px',
                          borderRadius: 8,
                          fontSize: '0.8rem',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#475569',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        +{n} pcs
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Bonus / Barang Gratis Supplier (Contoh Ades 10 dus + 1 bonus) */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Bonus / Barang Gratis Supplier ({selectedProduct.unit}) <span style={{ color: '#64748b', fontWeight: 500 }}>(Opsional)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={restockBonusQty}
                    onChange={(e) => setRestockBonusQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    placeholder="0 (contoh: 24 botol jika dapat bonus 1 dus gratis)"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                    }}
                  />
                  {restockBonusQty > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 700, marginTop: 4 }}>
                      Total masuk fisik: {restockQty + restockBonusQty} {selectedProduct.unit} ({restockQty} beli + {restockBonusQty} bonus gratis — HPP efektif otomatis menyesuaikan)
                    </div>
                  )}
                </div>

                {/* Input Tanggal Expired (FEFO — WAJIB SEMUA PRODUK) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                      Tanggal Kedaluwarsa / Expired <span style={{ color: '#ef4444' }}>* Wajib Semua Produk</span>
                    </label>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {[
                        { d: 0, label: 'Hari Ini' },
                        { d: 1, label: 'Besok' },
                        { d: 7, label: '+7h' },
                        { d: 30, label: '+30h' },
                      ].map(({ d, label }) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setExpiryDate(addDaysWibStr(d))}
                          style={{
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#f8fafc',
                            color: '#334155',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '3px 7px',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="date"
                    required
                    min={getTodayWibStr()}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      height: 'auto',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: !expiryDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '1rem',
                    }}
                  />
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                    Wajib diisi termasuk untuk makanan harian/basah (pilih &ldquo;Hari Ini&rdquo; jika wajib habis 1 hari).
                  </div>
                </div>

                {/* Input Catatan Opsional */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Catatan Penerimaan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Contoh: Titipan Bu Siti / Faktur No. 12"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      height: 'auto',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                    }}
                    maxLength={200}
                  />
                </div>

                {/* Kalkulasi Perubahan Stok */}
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    fontSize: '0.75rem',
                    color: '#1e40af',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Stok Sistem Setelah Restock:</span>
                  <strong>
                    {selectedProduct.stockQty + Number(restockQty) + Math.max(0, Math.floor(Number(restockBonusQty || 0)))} {selectedProduct.unit}
                  </strong>
                </div>

                {/* Tombol Submit & Batal */}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    className="btn btn-secondary"
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f1f5f9',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    disabled={submittingRestock}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: 'hsl(217 91% 60%)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                    disabled={submittingRestock}
                  >
                    {submittingRestock ? (
                      <>
                        <RefreshCw size={16} className="spin-icon" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>Simpan Stok Masuk</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL AJUKAN PRODUK BARU (GUDANG -> APPROVAL MANAGER) ── */}
      {canMutateStock && showNewProductModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 65,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
          }}
          onClick={() => !submittingNewProd && setShowNewProductModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 540,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: '20px 18px',
              boxShadow: '0 20px 30px -5px rgba(0, 0, 0, 0.25)',
              maxHeight: '92dvh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                    Tambah Produk Baru (Langsung Aktif)
                  </h3>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Input SKU/varian baru oleh Gudang atau Admin Shift — langsung tampil di Kasir &amp; tercatat di audit.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !submittingNewProd && setShowNewProductModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  minWidth: 40,
                  minHeight: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Tutup modal produk baru"
              >
                <X size={20} />
              </button>
            </div>

            {newProdError && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  backgroundColor: '#fef2f2',
                  border: '1px solid #ef4444',
                  color: '#991b1b',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {newProdError}
              </div>
            )}

            {newProdSuccessMsg ? (
              <div
                style={{
                  padding: '16px',
                  borderRadius: 10,
                  backgroundColor: '#dcfce7',
                  border: '1px solid #22c55e',
                  color: '#15803d',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
                <span>{newProdSuccessMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleProposeNewProductSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Nama Produk &amp; Varian Spesifik <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    placeholder="Contoh: Sendok Plastik / Aoka Rasa Vanila"
                    style={{
                      width: '100%',
                      minHeight: 42,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.95rem',
                    }}
                  />
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                    1 varian rasa / ukuran = 1 produk terpisah agar stok &amp; barcode tidak tertukar.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Kategori <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      required
                      value={newProdCategoryId}
                      onChange={(e) => setNewProdCategoryId(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        backgroundColor: '#fff',
                      }}
                    >
                      <option value="">-- Pilih Kategori --</option>
                      {categoriesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Barcode Produk (Opsional)
                    </label>
                    <input
                      type="text"
                      value={newProdBarcode}
                      onChange={(e) => setNewProdBarcode(e.target.value)}
                      placeholder="Scan / ketik barcode"
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      HPP / Harga Beli (Rp) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={newProdCostPrice}
                      onChange={(e) => setNewProdCostPrice(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Usulan Harga Jual (Rp) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      required
                      value={newProdSellingPrice}
                      onChange={(e) => setNewProdSellingPrice(e.target.value)}
                      placeholder="Misal: 3000"
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Satuan
                    </label>
                    <input
                      type="text"
                      value={newProdUnit}
                      onChange={(e) => setNewProdUnit(e.target.value)}
                      placeholder="pcs"
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Qty Awal <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      required
                      value={newProdInitialQty}
                      onChange={(e) => setNewProdInitialQty(Math.max(1, Number(e.target.value)))}
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                        fontWeight: 700,
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                        Tanggal Expired <span style={{ color: '#ef4444' }}>*Wajib</span>
                      </label>
                      <div style={{ display: 'inline-flex', gap: 3 }}>
                        {[
                          { d: 0, label: 'Hari Ini' },
                          { d: 7, label: '+7h' },
                          { d: 30, label: '+30h' },
                          { d: 365, label: '+1th' },
                        ].map(({ d, label }) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setNewProdExpiryDate(addDaysWibStr(d))}
                            style={{
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#f8fafc',
                              color: '#334155',
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="date"
                      required
                      min={getTodayWibStr()}
                      value={newProdExpiryDate}
                      onChange={(e) => setNewProdExpiryDate(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 42,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: !newProdExpiryDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                      }}
                    />
                  </div>
                </div>

                {/* Tipe Produk: Makanan Harian */}
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newProdIsPerishable}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNewProdIsPerishable(checked);
                        if (checked) {
                          setNewProdExpiryDate(getTodayWibStr());
                        }
                      }}
                    />
                    <span>Tandai sebagai Makanan Harian / Basah (Wajib habis hari ini)</span>
                  </label>

                  {newProdIsPerishable && (
                    <select
                      value={newProdPerishableType}
                      onChange={(e) => setNewProdPerishableType(e.target.value as 'KONSINYASI' | 'BELI_LEPAS')}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.8rem',
                        backgroundColor: '#fff',
                      }}
                    >
                      <option value="KONSINYASI">Konsinyasi (Titip Jual Mitra / Ibu Kantin)</option>
                      <option value="BELI_LEPAS">Beli Lepas (Modal Toko)</option>
                    </select>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Nama Supplier (Opsional)
                    </label>
                    <input
                      type="text"
                      value={newProdSupplier}
                      onChange={(e) => setNewProdSupplier(e.target.value)}
                      placeholder="Contoh: Toko Grosir Maju"
                      style={{
                        width: '100%',
                        minHeight: 40,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      Catatan untuk Manager (Opsional)
                    </label>
                    <input
                      type="text"
                      value={newProdNotes}
                      onChange={(e) => setNewProdNotes(e.target.value)}
                      placeholder="Contoh: Banyak diminta mahasiswa"
                      style={{
                        width: '100%',
                        minHeight: 40,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={submittingNewProd}
                    onClick={() => setShowNewProductModal(false)}
                    className="btn btn-secondary"
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f1f5f9',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submittingNewProd}
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: '#059669',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {submittingNewProd ? (
                      <>
                        <RefreshCw size={16} className="spin-icon" />
                        <span>Menyimpan Produk...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>Simpan Produk Baru</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL KAMERA SCANNER BARCODE ── */}
      {isScanning && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: '#000000',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header Scanner */}
          <div
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Barcode size={20} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Arahkan Kamera ke Barcode</span>
            </div>
            <button
              type="button"
              onClick={stopScanner}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Tutup kamera scanner"
            >
              <X size={20} />
            </button>
          </div>

          {/* Area Video Viewfinder */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* Kotak Bidik Scanner */}
            <div
              style={{
                position: 'absolute',
                width: '75%',
                maxWidth: 280,
                height: 180,
                border: '2px solid hsl(217 91% 60%)',
                borderRadius: 16,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'none',
              }}
            />

            {cameraError && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20,
                  padding: 12,
                  backgroundColor: 'rgba(239,68,68,0.9)',
                  color: '#fff',
                  borderRadius: 10,
                  fontSize: '0.8rem',
                  textAlign: 'center',
                }}
              >
                {cameraError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL PUSAT NOTIFIKASI KEPUTUSAN MANAGER (ACC / REVISI / DITOLAK) ── */}
      {showNotifModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
          }}
          onClick={() => setShowNotifModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 520,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 20px 30px -5px rgba(0, 0, 0, 0.25)',
              maxHeight: '88dvh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                backgroundColor: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Bell size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                    Notifikasi Keputusan Manager
                  </h3>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Status pengajuan produk baru &amp; restock 7 hari terakhir
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                aria-label="Tutup notifikasi"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  minWidth: 38,
                  minHeight: 38,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!approvalNotifs || approvalNotifs.recentItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 12px', color: '#64748b', fontSize: '0.84rem' }}>
                  Belum ada notifikasi keputusan Manager dalam 7 hari terakhir.
                </div>
              ) : (
                approvalNotifs.recentItems.map((n) => {
                  const isRejected = n.status === 'REJECTED';
                  const isRevised = n.status === 'REVISED';
                  const isApproved = n.status === 'APPROVED';
                  const isUnread =
                    (isRejected || isRevised || isApproved) &&
                    new Date(n.updatedAt).getTime() > lastReadNotifTs;

                  const bg = isRejected
                    ? '#fef2f2'
                    : isRevised
                    ? '#fff7ed'
                    : isApproved
                    ? '#f0fdf4'
                    : '#f8fafc';
                  const border = isRejected
                    ? '#fca5a5'
                    : isRevised
                    ? '#fdba74'
                    : isApproved
                    ? '#86efac'
                    : '#e2e8f0';
                  const badgeBg = isRejected
                    ? '#dc2626'
                    : isRevised
                    ? '#ea580c'
                    : isApproved
                    ? '#16a34a'
                    : '#2563eb';
                  const statusLabel = isRejected
                    ? 'DITOLAK MANAGER'
                    : isRevised
                    ? 'PERLU REVISI'
                    : isApproved
                    ? 'DISETUJUI (ACC)'
                    : 'MENUNGGU ACC';

                  return (
                    <div
                      key={n.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        backgroundColor: bg,
                        border: `${isUnread ? '1.5px' : '1px'} solid ${border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              backgroundColor: badgeBg,
                              color: '#ffffff',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                            }}
                          >
                            {statusLabel}
                          </span>
                          {n.isNewProductProposal && (
                            <span
                              style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                backgroundColor: '#ede9fe',
                                color: '#6d28d9',
                                fontSize: '0.66rem',
                                fontWeight: 800,
                              }}
                            >
                              PRODUK BARU
                            </span>
                          )}
                          {isUnread && (
                            <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#dc2626' }}>
                              • BARU
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                          #{n.receiveNumber}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                        {n.productSummary}
                      </div>

                      {n.managerNote && (
                        <div
                          style={{
                            padding: '7px 10px',
                            borderRadius: 8,
                            backgroundColor: '#ffffff',
                            border: '1px solid rgba(0,0,0,0.08)',
                            fontSize: '0.78rem',
                            color: isRejected ? '#991b1b' : isRevised ? '#9a3412' : '#1e293b',
                          }}
                        >
                          <strong>Alasan / Catatan Manager:</strong> &ldquo;{n.managerNote}&rdquo;
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {new Date(n.updatedAt).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Jakarta',
                          })}{' '}
                          WIB
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            jumpToPenerimaanStatus(
                              isRejected
                                ? 'rejected'
                                : isRevised
                                ? 'revised'
                                : isApproved
                                ? 'approved'
                                : 'submitted',
                            )
                          }
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: 'none',
                            backgroundColor: '#0f172a',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Buka di Tab Penerimaan →
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  markAllNotifsAsRead();
                  setShowNotifModal(false);
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tandai Semua Sudah Dibaca
              </button>
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Produk & Tanggal Expired */}
      {canMutateStock && editingProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 20px 40px rgb(0 0 0 / 0.25)',
              maxHeight: '90dvh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                Edit Produk &amp; Tanggal Expired
              </h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6 }}
                aria-label="Tutup modal edit produk"
              >
                <X size={20} />
              </button>
            </div>
            {editError && (
              <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.78rem', fontWeight: 600, marginBottom: 10 }}>
                {editError}
              </div>
            )}
            <form onSubmit={handleEditProductSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Nama Produk
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Barcode (Kosongkan jika Non-Barcode)
                  </label>
                  <input
                    type="text"
                    value={editBarcode}
                    onChange={(e) => setEditBarcode(e.target.value)}
                    placeholder="EAN-13 / kosong"
                    style={{ width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Satuan
                  </label>
                  <input
                    type="text"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    style={{ width: '100%', minHeight: 42, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Koreksi Stok Fisik (Saat ini: {editingProduct.stockQty} {editingProduct.unit})
                </label>
                <input
                  type="number"
                  min={0}
                  value={editStockQty}
                  onChange={(e) => setEditStockQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  style={{ width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.95rem', fontWeight: 700 }}
                />
              </div>

              {/* ── EDIT TANGGAL KEDALUWARSA / EXPIRED PER BATCH AKTIF ── */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Calendar size={14} style={{ color: '#2563eb' }} />
                    <span>
                      Tanggal Kedaluwarsa / Expired
                      {editBatches.length > 1 ? ` (${editBatches.length} Batch Aktif)` : ''}
                    </span>
                  </span>
                  {loadingEditBatches && (
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Memuat batch...</span>
                  )}
                </div>

                {loadingEditBatches ? (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '4px 0' }}>
                    Memuat rincian batch produk...
                  </div>
                ) : editBatches.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {editBatches.map((batch) => {
                      const isPast = Boolean(batch.expiryDate && batch.expiryDate < getTodayWibStr());
                      return (
                        <div
                          key={batch.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            backgroundColor: '#ffffff',
                            border: !batch.expiryDate ? '1px solid #fcd34d' : isPast ? '1px solid #fca5a5' : '1px solid #e2e8f0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', fontFamily: 'monospace' }}>
                              #{batch.batchCode} &bull; Sisa {batch.currentQty} {editUnit || editingProduct.unit}
                            </span>
                            <div style={{ display: 'inline-flex', gap: 3 }}>
                              {[
                                { d: 0, label: 'Hari Ini' },
                                { d: 30, label: '+30h' },
                                { d: 180, label: '+6bln' },
                                { d: 365, label: '+1th' },
                              ].map(({ d, label }) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() =>
                                    setEditBatches((prev) =>
                                      prev.map((x) =>
                                        x.id === batch.id ? { ...x, expiryDate: addDaysWibStr(d) } : x,
                                      ),
                                    )
                                  }
                                  style={{
                                    border: '1px solid #cbd5e1',
                                    backgroundColor: '#f8fafc',
                                    color: '#334155',
                                    fontSize: '0.64rem',
                                    fontWeight: 700,
                                    padding: '2px 5px',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <input
                            type="date"
                            value={batch.expiryDate}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditBatches((prev) =>
                                prev.map((x) => (x.id === batch.id ? { ...x, expiryDate: val } : x)),
                              );
                            }}
                            style={{
                              width: '100%',
                              minHeight: 40,
                              padding: '6px 10px',
                              borderRadius: 7,
                              border: !batch.expiryDate ? '1px solid #f59e0b' : '1px solid #cbd5e1',
                              fontSize: '0.9rem',
                            }}
                          />
                          {isPast && (
                            <div style={{ fontSize: '0.68rem', color: '#b91c1c', fontWeight: 600 }}>
                              Tanggal sudah lewat — batch akan otomatis masuk Radar FEFO sebagai EXPIRED.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : editStockQty > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                        Exp untuk batch baru ({editStockQty} {editUnit || editingProduct.unit})
                      </span>
                      <div style={{ display: 'inline-flex', gap: 3 }}>
                        {[
                          { d: 0, label: 'Hari Ini' },
                          { d: 30, label: '+30h' },
                          { d: 180, label: '+6bln' },
                          { d: 365, label: '+1th' },
                        ].map(({ d, label }) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setEditSingleExpiryDate(addDaysWibStr(d))}
                            style={{
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="date"
                      value={editSingleExpiryDate}
                      onChange={(e) => setEditSingleExpiryDate(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 40,
                        padding: '6px 10px',
                        borderRadius: 7,
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        backgroundColor: '#ffffff',
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Produk saat ini stok 0 (belum ada batch aktif). Isi stok di atas atau gunakan tombol Restock untuk mengisi tanggal expired.
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Alasan Perubahan (Opsional)
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Contoh: Isi tanggal expired / koreksi stok opname"
                  style={{ width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  style={{ minHeight: 42, padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#334155', fontWeight: 600, cursor: 'pointer' }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit || loadingEditBatches}
                  style={{ minHeight: 42, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#2563eb', color: '#ffffff', fontWeight: 700, cursor: submittingEdit || loadingEditBatches ? 'not-allowed' : 'pointer', opacity: loadingEditBatches ? 0.65 : 1 }}
                >
                  {submittingEdit ? 'Menyimpan...' : loadingEditBatches ? 'Memuat Batch...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
