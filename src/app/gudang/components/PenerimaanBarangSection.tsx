'use client';
// =============================================================
// src/app/kasir/gudang/components/PenerimaanBarangSection.tsx
// Modul Penerimaan Barang Masuk & 2-Layer Approval (Wiramart v3.0)
// STANDAR: Mobile-First Ergonomics, Zero-Trust Validation, Clean HSL System
// =============================================================

import { useState, useEffect, useId } from 'react';
import {
  Truck,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Trash2,
  Layers,
  ChevronRight,
  Eye,
  Send,
  X,
  AlertCircle,
  Edit3,
  Camera,
  Sparkles,
  FileSpreadsheet,
  Calculator,
  Calendar,
} from 'lucide-react';

export type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';

export type DraftSummaryItem = {
  id: string;
  receiveNumber: string;
  supplierName: string | null;
  deliveryNote: string | null;
  invoiceDate?: string | null;
  invoicePhotoUrl?: string | null;
  status: DraftStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  managerNote: string | null;
  createdAt: string;
  creatorName: string;
  creatorNim: string;
};

export type DraftItemDetail = {
  id?: string;
  productId: string;
  productName: string;
  batchCode: string;
  qty: number;
  costPrice: number;
  expiryDate?: string | null;
  conditionNote?: string | null;
};

export type DraftFullDetail = DraftSummaryItem & {
  items: DraftItemDetail[];
};

export type SupplierInvoiceTableRow = {
  itemId: string;
  draftId: string;
  receiveNumber: string;
  invoiceDate: string;
  deliveryNote: string | null;
  invoicePhotoUrl: string | null;
  status: DraftStatus;
  supplierName: string;
  productId: string;
  productName: string;
  batchCode: string;
  qty: number;
  costPrice: number;
  totalPrice: number;
  expiryDate: string | null;
  conditionNote: string | null;
  creatorName: string;
  createdAt: string;
};

export type ProductOption = {
  id: string;
  name: string;
  barcode: string | null;
  categoryName: string;
  stockQty: number;
  unit: string;
  isPerishable: boolean;
};

interface PenerimaanBarangSectionProps {
  productsList: ProductOption[];
  onDraftApproved?: () => void;
}

async function requestDrafts(filter: string, signal?: AbortSignal): Promise<DraftSummaryItem[]> {
  const url =
    filter === 'semua'
      ? '/api/gudang/penerimaan'
      : `/api/gudang/penerimaan?status=${filter.toUpperCase()}`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? 'Gagal memuat antrian penerimaan barang');
  }
  return json.data.items || [];
}

async function requestInvoiceTableRows(filter: string, signal?: AbortSignal): Promise<SupplierInvoiceTableRow[]> {
  const statusQuery = filter === 'semua' ? '' : `&status=${filter.toUpperCase()}`;
  const res = await fetch(`/api/gudang/penerimaan?view=table&limit=200${statusQuery}`, { signal });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? 'Gagal memuat tabel buku nota supplier');
  }
  return json.data.items || [];
}

function createDefaultBatchCode(): string {
  const today = new Date();
  return `B${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function getTodayWibStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

// ── Helper Kompresi Gambar Nota di Browser (HTML5 Canvas -> JPEG <= 200KB) ──
async function compressInvoiceImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto nota.'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.onload = () => {
        const maxDim = 1280;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Gagal memproses kompresi gambar.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.76);
        resolve(compressed);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// ── Helper Fuzzy Matching Nama Barang Nota ke Master Produk Wiramart ──
function computeProductSimilarity(rawQuery: string, product: ProductOption): number {
  const cleanQ = rawQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const cleanName = product.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  if (!cleanQ || !cleanName) return 0;
  if (product.barcode && cleanQ.includes(product.barcode.toLowerCase())) return 1.0;
  if (cleanName === cleanQ) return 0.99;
  if (cleanName.includes(cleanQ) || cleanQ.includes(cleanName)) return 0.88;

  const qTokens = cleanQ.split(/\s+/).filter((t) => t.length >= 2);
  const nameTokens = cleanName.split(/\s+/).filter((t) => t.length >= 2);
  if (qTokens.length === 0 || nameTokens.length === 0) return 0;

  let matchedTokens = 0;
  for (const qt of qTokens) {
    if (nameTokens.some((nt) => nt === qt || nt.startsWith(qt) || qt.startsWith(nt))) {
      matchedTokens += 1;
    }
  }
  return matchedTokens / Math.max(qTokens.length, nameTokens.length * 0.65);
}

type SupplierOptionItem = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
};

let suppliersMemCache: SupplierOptionItem[] = [];
const penerimaanMemCache = new Map<
  string,
  { itemsData: DraftSummaryItem[]; tableData: SupplierInvoiceTableRow[] }
>();

export default function PenerimaanBarangSection({
  productsList,
  onDraftApproved,
}: PenerimaanBarangSectionProps) {
  const modalSearchId = useId();
  const photoUploadId = useId();

  // State Mode Tampilan: 'cards' (Antrian Draft) | 'table' (Tabel Buku Nota Lengkap)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // State List Drafts & Tabel Buku Nota (inisialisasi instan dari memori cache)
  const [statusFilter, setStatusFilter] = useState<string>('semua');
  const [drafts, setDrafts] = useState<DraftSummaryItem[]>(
    () => penerimaanMemCache.get('semua')?.itemsData ?? [],
  );
  const [tableRows, setTableRows] = useState<SupplierInvoiceTableRow[]>(
    () => penerimaanMemCache.get('semua')?.tableData ?? [],
  );
  const [tableSearch, setTableSearch] = useState('');
  const [loading, setLoading] = useState<boolean>(() => !penerimaanMemCache.has('semua'));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State Modal Preview Foto Nota
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [previewPhotoTitle, setPreviewPhotoTitle] = useState<string>('');

  // State Modal Detail
  const [viewingDraftId, setViewingDraftId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DraftFullDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // State Form Modal (Input / Edit)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [registeredSuppliers, setRegisteredSuppliers] = useState<SupplierOptionItem[]>(
    () => suppliersMemCache,
  );
  const [deliveryNote, setDeliveryNote] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => getTodayWibStr());
  const [invoicePhotoUrl, setInvoicePhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [items, setItems] = useState<DraftItemDetail[]>([]);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // State Pencocokan Otomatis Rincian Faktur
  const [isSmartMatcherOpen, setIsSmartMatcherOpen] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState('');
  const [smartMatchFeedback, setSmartMatchFeedback] = useState<string | null>(null);

  // State Picker Produk
  const [productSearch, setProductSearch] = useState('');
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);

  // ── Load List Pemasok Terdaftar (dengan Cache Memori Instan) ────
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/gudang/suppliers', { signal: controller.signal })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!controller.signal.aborted && ok && json.success && Array.isArray(json.data)) {
          suppliersMemCache = json.data;
          setRegisteredSuppliers(json.data);
        }
      })
      .catch(() => {
        // silent
      });
    return () => controller.abort();
  }, []);

  // ── Load List Drafts & Tabel Buku Nota (Stale-While-Revalidate Cache) ──
  function handleSelectFilter(nextFilter: string) {
    setStatusFilter(nextFilter);
    const cached = penerimaanMemCache.get(nextFilter);
    if (cached) {
      setDrafts(cached.itemsData);
      setTableRows(cached.tableData);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  async function fetchDrafts(filter = statusFilter) {
    if (!penerimaanMemCache.has(filter)) setLoading(true);
    setErrorMsg(null);
    try {
      const [itemsData, tableData] = await Promise.all([
        requestDrafts(filter),
        requestInvoiceTableRows(filter),
      ]);
      penerimaanMemCache.set(filter, { itemsData, tableData });
      setDrafts(itemsData);
      setTableRows(tableData);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan sistem.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestDrafts(statusFilter, controller.signal),
      requestInvoiceTableRows(statusFilter, controller.signal),
    ])
      .then(([itemsData, tableData]) => {
        if (controller.signal.aborted) return;
        penerimaanMemCache.set(statusFilter, { itemsData, tableData });
        setErrorMsg(null);
        setDrafts(itemsData);
        setTableRows(tableData);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan sistem.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [statusFilter]);

  // ── Load Detail Draft ────────────────────────────────────────
  async function openDetailModal(draftId: string) {
    setViewingDraftId(draftId);
    setLoadingDetail(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/gudang/penerimaan/${draftId}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setDetailData(json.data);
      } else {
        alert(json.error ?? 'Gagal memuat detail penerimaan barang.');
        setViewingDraftId(null);
      }
    } catch {
      alert('Gagal mengambil detail dari server.');
      setViewingDraftId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  // ── Buka Form Tambah Baru ────────────────────────────────────
  function openCreateModal() {
    setEditingDraftId(null);
    setSupplierName('');
    setDeliveryNote('');
    setInvoiceDate(getTodayWibStr());
    setInvoicePhotoUrl(null);
    setSmartPasteText('');
    setSmartMatchFeedback(null);
    setIsSmartMatcherOpen(false);
    setItems([]);
    setFormError(null);
    setIsFormOpen(true);
  }

  // ── Buka Form Edit Draft (Hanya DRAFT / REVISED) ──────────────
  async function openEditModal(draftId: string) {
    setFormError(null);
    setSubmittingForm(true);
    try {
      const res = await fetch(`/api/gudang/penerimaan/${draftId}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.error ?? 'Gagal memuat draft untuk diedit.');
        return;
      }
      const d: DraftFullDetail = json.data;
      setEditingDraftId(d.id);
      setSupplierName(d.supplierName || '');
      setDeliveryNote(d.deliveryNote || '');
      setInvoiceDate(d.invoiceDate || getTodayWibStr());
      setInvoicePhotoUrl(d.invoicePhotoUrl || null);
      setSmartPasteText('');
      setSmartMatchFeedback(null);
      setIsSmartMatcherOpen(false);
      setItems(
        d.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          batchCode: it.batchCode,
          qty: it.qty,
          costPrice: Number(it.costPrice),
          expiryDate: it.expiryDate || '',
          conditionNote: it.conditionNote || '',
        })),
      );
      setViewingDraftId(null);
      setIsFormOpen(true);
    } catch {
      alert('Gagal membuka form edit.');
    } finally {
      setSubmittingForm(false);
    }
  }

  // ── OTOMATISASI 3: Upload & Kompresi Foto Nota + Auto-Detect ───
  async function handleUploadInvoicePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setFormError(null);
    try {
      const dataUrl = await compressInvoiceImageToDataUrl(file);
      setInvoicePhotoUrl(dataUrl);

      if (!invoiceDate) {
        setInvoiceDate(getTodayWibStr());
      }
      // Jika nama supplier belum diisi, coba deteksi dari nama file foto
      if (!supplierName.trim()) {
        const cleanFileName = file.name.replace(/\.[^.]+$/, '').toLowerCase();
        const matchedSupplier = registeredSuppliers.find((s) =>
          cleanFileName.includes(s.name.toLowerCase()),
        );
        if (matchedSupplier) {
          setSupplierName(matchedSupplier.name);
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memproses foto nota.');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  }

  // ── OTOMATISASI 1: Auto-Fill Barang & Harga dari Riwayat Nota Supplier ──
  const supplierHistoryItems = (() => {
    const cleanSup = supplierName.trim().toLowerCase();
    if (!cleanSup) return [];
    const seenProducts = new Map<string, SupplierInvoiceTableRow>();
    for (const r of tableRows) {
      if (r.supplierName.toLowerCase().includes(cleanSup) || cleanSup.includes(r.supplierName.toLowerCase())) {
        if (!seenProducts.has(r.productId)) {
          seenProducts.set(r.productId, r);
        }
      }
    }
    return Array.from(seenProducts.values());
  })();

  function handleAutoFillFromSupplierHistory() {
    if (supplierHistoryItems.length === 0) return;
    const existingIds = new Set(items.map((it) => it.productId));
    const newItems: DraftItemDetail[] = [];

    for (const hist of supplierHistoryItems) {
      if (existingIds.has(hist.productId)) continue;
      const prodMeta = productsList.find((p) => p.id === hist.productId);
      newItems.push({
        productId: hist.productId,
        productName: hist.productName,
        batchCode: createDefaultBatchCode(),
        qty: hist.qty > 0 ? hist.qty : 1,
        costPrice: hist.costPrice,
        expiryDate: prodMeta?.isPerishable ? addDaysToToday(1) : '',
        conditionNote: 'Sesuai riwayat faktur pemasok',
      });
    }

    if (newItems.length > 0) {
      setItems((prev) => [...prev, ...newItems]);
      setSmartMatchFeedback(
        `Berhasil memuat otomatis ${newItems.length} item produk beserta harga beli terakhir dari pemasok "${supplierName}". Silakan periksa kembali kuantitas dan tanggal kedaluwarsa.`,
      );
    } else {
      setSmartMatchFeedback('Seluruh item dari riwayat pemasok ini telah berada di dalam daftar formulir.');
    }
  }

  // ── OTOMATISASI 2: Smart Auto-Match Teks Nota / WA ke Database Produk ──
  function handleSmartMatchNotaText() {
    setFormError(null);
    setSmartMatchFeedback(null);
    const lines = smartPasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2);

    if (lines.length === 0) {
      setFormError('Tempelkan teks rincian nota atau daftar barang terlebih dahulu.');
      return;
    }

    let matchedCount = 0;
    const addedItems: DraftItemDetail[] = [];

    for (const line of lines) {
      // Cek apakah baris adalah metadata header (Supplier / No Faktur / Tanggal)
      const supMatch = line.match(/^(?:supplier|pemasok|toko|mitra)\s*[:=-]\s*(.+)$/i);
      if (supMatch && supMatch[1] && !supplierName.trim()) {
        setSupplierName(supMatch[1].trim());
        continue;
      }
      const noNotaMatch = line.match(/^(?:no\.?\s*(?:nota|faktur|sj)|faktur|nota)\s*[:=-]\s*(.+)$/i);
      if (noNotaMatch && noNotaMatch[1] && !deliveryNote.trim()) {
        setDeliveryNote(noNotaMatch[1].trim());
        continue;
      }

      // Ekstrak tanggal expired jika ada di baris (YYYY-MM-DD atau DD/MM/YYYY)
      let detectedExpiry = '';
      let workingLine = line;
      const isoDateMatch = workingLine.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
      if (isoDateMatch && isoDateMatch[1]) {
        detectedExpiry = isoDateMatch[1];
        workingLine = workingLine.replace(isoDateMatch[0], ' ');
      } else {
        const dmyMatch = workingLine.match(/\b(\d{2})[/-](\d{2})[/-](20\d{2})\b/);
        if (dmyMatch) {
          detectedExpiry = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
          workingLine = workingLine.replace(dmyMatch[0], ' ');
        }
      }

      // Bersihkan penanda ribuan (misal Rp 3.500 -> 3500)
      const normalizedNumbersLine = workingLine
        .replace(/rp\.?\s*/gi, '')
        .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')
        .replace(/(\d),(\d{3})(?!\d)/g, '$1$2');

      const numMatches = Array.from(normalizedNumbersLine.matchAll(/\b\d+\b/g)).map((m) => Number(m[0]));
      // Teks nama barang = hapus angka-angka qty/harga & satuan umum
      const textOnly = normalizedNumbersLine
        .replace(/\b\d+\s*(?:pcs|bh|bks|bungkus|pak|pack|dus|box|botol|btl|cup|unit|x|@)?\b/gi, ' ')
        .replace(/[@x×=-]/g, ' ')
        .trim();

      if (textOnly.length < 2) continue;

      // Cari produk paling mirip di productsList
      let bestProd: ProductOption | null = null;
      let bestScore = 0;
      for (const prod of productsList) {
        const score = computeProductSimilarity(textOnly, prod);
        if (score > bestScore) {
          bestScore = score;
          bestProd = prod;
        }
      }

      if (!bestProd || bestScore < 0.34) continue;

      // Tentukan Qty dan Harga Satuan dari angka yang ditemukan di baris
      let qty = 1;
      let costPrice = 0;
      if (numMatches.length === 1) {
        if (numMatches[0] <= 500) {
          qty = Math.max(1, numMatches[0]);
        } else {
          costPrice = numMatches[0];
        }
      } else if (numMatches.length >= 2) {
        const smallNums = numMatches.filter((n) => n >= 1 && n <= 499);
        const largeNums = numMatches.filter((n) => n >= 500);
        if (smallNums.length > 0 && largeNums.length > 0) {
          qty = smallNums[0];
          // Jika ada 2 angka besar (misal harga satuan 3000 dan total 60000), ambil harga satuan terkecil
          const sortedLarge = [...largeNums].sort((a, b) => a - b);
          costPrice = sortedLarge[0];
          // Jika hanya 1 angka besar dan habis dibagi qty menjadi harga wajar (>= 500), cek apakah itu harga total
          if (largeNums.length === 1 && qty > 1 && largeNums[0] >= qty * 1000 && largeNums[0] % qty === 0) {
            // Biarkan sebagai harga satuan bila <= 15000, atau bagi otomatis bila > 25000
            if (largeNums[0] > 25000) {
              costPrice = Math.round(largeNums[0] / qty);
            }
          }
        } else {
          qty = Math.max(1, numMatches[0]);
          costPrice = numMatches[1] ?? 0;
        }
      }

      // Jika costPrice masih 0, cek apakah ada riwayat harga terakhir di tableRows
      if (costPrice === 0) {
        const prevRow = tableRows.find((r) => r.productId === bestProd.id && r.costPrice > 0);
        if (prevRow) costPrice = prevRow.costPrice;
      }

      addedItems.push({
        productId: bestProd.id,
        productName: bestProd.name,
        batchCode: createDefaultBatchCode(),
        qty,
        costPrice,
        expiryDate: detectedExpiry || (bestProd.isPerishable ? addDaysToToday(1) : ''),
        conditionNote: `Ekstraksi otomatis faktur ("${textOnly.slice(0, 40)}")`,
      });
      matchedCount += 1;
    }

    if (addedItems.length === 0) {
      setFormError(
        'Tidak ditemukan nama produk yang sesuai dengan katalog master Wiramart. Gunakan format per baris: "Nama Produk [Kuantitas] [Harga Satuan]".',
      );
      return;
    }

    setItems((prev) => [...prev, ...addedItems]);
    setSmartMatchFeedback(
      `Berhasil mencocokkan secara otomatis ${matchedCount} item produk dari teks faktur ke katalog produk Wiramart.`,
    );
    setSmartPasteText('');
    setIsSmartMatcherOpen(false);
  }

  // ── Tambah Produk ke List ────────────────────────────────────
  function handleSelectProduct(prod: ProductOption) {
    const batchCode = createDefaultBatchCode();
    const lastKnownPrice = tableRows.find((r) => r.productId === prod.id && r.costPrice > 0)?.costPrice ?? 0;

    setItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        batchCode,
        qty: 1,
        costPrice: lastKnownPrice,
        expiryDate: prod.isPerishable ? addDaysToToday(1) : '',
        conditionNote: 'Kondisi kemasan rapi dan tersegel',
      },
    ]);
    setIsProductPickerOpen(false);
    setProductSearch('');
  }

  // ── Hapus Produk dari Form ───────────────────────────────────
  function handleRemoveItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Update Item Field ────────────────────────────────────────
  function handleUpdateItem(idx: number, field: keyof DraftItemDetail, val: unknown) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i === idx) {
          return { ...it, [field]: val };
        }
        return it;
      }),
    );
  }

  // ── Simpan Draft (atau Update) ───────────────────────────────
  async function handleSubmitForm(shouldSubmitToManager: boolean) {
    setFormError(null);

    if (items.length === 0) {
      setFormError('Wajib memasukkan minimal 1 item produk barang masuk.');
      return;
    }

    // Validasi field
    for (const [index, it] of items.entries()) {
      if (it.qty <= 0) {
        setFormError(`Item #${index + 1} (${it.productName}): Jumlah kuantitas minimal 1.`);
        return;
      }
      if (it.costPrice < 0) {
        setFormError(`Item #${index + 1} (${it.productName}): Harga beli tidak boleh negatif.`);
        return;
      }
      if (!it.batchCode.trim()) {
        setFormError(`Item #${index + 1} (${it.productName}): Kode batch wajib diisi.`);
        return;
      }
    }

    setSubmittingForm(true);
    try {
      const payload = {
        supplierName: supplierName.trim() || undefined,
        deliveryNote: deliveryNote.trim() || undefined,
        invoiceDate: invoiceDate || undefined,
        invoicePhotoUrl: invoicePhotoUrl || undefined,
        autoSubmit: shouldSubmitToManager,
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          batchCode: it.batchCode.trim(),
          qty: Number(it.qty),
          costPrice: Number(it.costPrice),
          expiryDate: it.expiryDate || undefined,
          conditionNote: it.conditionNote?.trim() || undefined,
        })),
      };

      if (editingDraftId) {
        // PATCH update
        const res = await fetch(`/api/gudang/penerimaan/${editingDraftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memperbarui nota penerimaan');
      } else {
        // POST create (sudah mendukung autoSubmit langsung di server!)
        const res = await fetch('/api/gudang/penerimaan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan nota penerimaan');
      }

      setIsFormOpen(false);
      fetchDrafts(statusFilter);
      if (onDraftApproved) onDraftApproved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Terjadi kegagalan saat menyimpan data.');
    } finally {
      setSubmittingForm(false);
    }
  }

  // ── Ajukan Draft Langsung dari List / Modal Detail ────────────
  async function handleDirectSubmit(draftId: string) {
    if (!confirm('Yakin ingin mengajukan penerimaan barang ini ke Manager untuk disetujui?')) {
      return;
    }
    try {
      const res = await fetch(`/api/gudang/penerimaan/${draftId}/submit`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.error ?? 'Gagal mengajukan penerimaan barang.');
        return;
      }
      alert('Penerimaan barang berhasil diajukan ke Manager!');
      setViewingDraftId(null);
      fetchDrafts(statusFilter);
    } catch {
      alert('Gagal menghubungi server.');
    }
  }

  // Helper Badge Status
  function renderStatusBadge(status: DraftStatus) {
    switch (status) {
      case 'DRAFT':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#fef3c7',
              color: '#d97706',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Clock size={12} /> DRAFT
          </span>
        );
      case 'SUBMITTED':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#e0f2fe',
              color: '#0284c7',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Send size={12} /> MENUNGGU ACC
          </span>
        );
      case 'APPROVED':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#dcfce7',
              color: '#15803d',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CheckCircle2 size={12} /> DISETUJUI (MASUK)
          </span>
        );
      case 'REVISED':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#ffedd5',
              color: '#ea580c',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <AlertTriangle size={12} /> PERLU REVISI
          </span>
        );
      case 'REJECTED':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#fee2e2',
              color: '#b91c1c',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <XCircle size={12} /> DITOLAK
          </span>
        );
      default:
        return null;
    }
  }

  // Filter Produk untuk Picker
  const filteredProductOptions = productsList.filter((p) => {
    if (!productSearch.trim()) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q));
  });

  // Filter Baris untuk Tabel Buku Nota Lengkap
  const filteredTableRows = tableRows.filter((r) => {
    if (!tableSearch.trim()) return true;
    const q = tableSearch.toLowerCase();
    return (
      r.supplierName.toLowerCase().includes(q) ||
      r.productName.toLowerCase().includes(q) ||
      r.receiveNumber.toLowerCase().includes(q) ||
      (r.deliveryNote && r.deliveryNote.toLowerCase().includes(q))
    );
  });

  const totalTableQty = filteredTableRows.reduce((acc, r) => acc + r.qty, 0);
  const totalTableAmount = filteredTableRows.reduce((acc, r) => acc + r.totalPrice, 0);
  const totalFormQty = items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
  const totalFormAmount = items.reduce(
    (acc, it) => acc + (Number(it.qty) || 0) * (Number(it.costPrice) || 0),
    0,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── HEADER & ACTION BAR ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: '#ffffff',
          padding: '14px 16px',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 800,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Truck size={20} color="#0284c7" /> Penerimaan Barang & Arsip Nota Supplier
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Upload foto nota supplier, auto-match rincian barang, dan lihat Tabel Buku Nota Lengkap.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {/* Toggle Mode Tampilan: Kartu vs Tabel Buku Nota */}
          <div
            style={{
              display: 'inline-flex',
              background: '#f1f5f9',
              padding: 4,
              borderRadius: 10,
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              style={{
                minHeight: 44,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                background: viewMode === 'cards' ? '#ffffff' : 'transparent',
                color: viewMode === 'cards' ? '#0f172a' : '#64748b',
                boxShadow: viewMode === 'cards' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Layers size={14} /> Antrian Nota
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              style={{
                minHeight: 44,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                background: viewMode === 'table' ? '#ffffff' : 'transparent',
                color: viewMode === 'table' ? '#0284c7' : '#64748b',
                boxShadow: viewMode === 'table' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <FileSpreadsheet size={14} /> Tabel Buku Nota ({tableRows.length})
            </button>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 44,
              padding: '10px 16px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: 10,
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
              transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <Plus size={16} /> + Upload & Input Nota
          </button>
        </div>
      </div>

      {/* ── FILTER STATUS TABS ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 4,
        }}
      >
        {[
          { id: 'semua', label: 'Semua Status' },
          { id: 'draft', label: 'Draft' },
          { id: 'submitted', label: 'Menunggu ACC' },
          { id: 'revised', label: 'Perlu Revisi' },
          { id: 'approved', label: 'Disetujui' },
          { id: 'rejected', label: 'Ditolak' },
        ].map((f) => {
          const isActive = statusFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => handleSelectFilter(f.id)}
              style={{
                minHeight: 44,
                padding: '8px 14px',
                borderRadius: 20,
                fontSize: '0.8rem',
                fontWeight: isActive ? 700 : 500,
                border: isActive ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                backgroundColor: isActive ? '#e0f2fe' : '#ffffff',
                color: isActive ? '#0369a1' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {f.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => fetchDrafts(statusFilter)}
          style={{
            marginLeft: 'auto',
            minHeight: 44,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.78rem',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title="Segarkan data"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Segarkan
        </button>
      </div>

      {/* ── VIEW 1: TABEL BUKU NOTA SUPPLIER LENGKAP (SPREADSHEET FORMAT) ── */}
      {viewMode === 'table' ? (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                📊 Buku Arsip Nota Supplier (Format Tabel Lengkap)
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                Menampilkan rincian Tanggal Faktur, No. Faktur, Foto Nota, Supplier, Nama Barang, Qty, Harga, Jumlah, & Expired.
              </p>
            </div>
            <div style={{ position: 'relative', minWidth: 240, flex: '1 1 240px', maxWidth: 360 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Cari supplier, nama barang, atau no. faktur..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '8px 12px 8px 34px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--text-base)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 860 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', textAlign: 'left', color: '#334155' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>Tgl Faktur</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>No. Faktur & Foto</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>Nama Supplier</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>Nama Barang</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800, textAlign: 'right' }}>Kuantiti</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800, textAlign: 'right' }}>Harga Satuan</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800, textAlign: 'right' }}>Jumlah (Total)</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>Expired Date</th>
                  <th style={{ padding: '10px 12px', fontWeight: 800 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                      Belum ada rincian item nota supplier yang sesuai filter.
                    </td>
                  </tr>
                ) : (
                  filteredTableRows.map((row) => (
                    <tr key={row.itemId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: '#0f172a' }}>
                        {row.invoiceDate}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                          {row.deliveryNote || row.receiveNumber}
                        </div>
                        {row.invoicePhotoUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewPhotoUrl(row.invoicePhotoUrl);
                              setPreviewPhotoTitle(`${row.supplierName} — ${row.deliveryNote || row.receiveNumber}`);
                            }}
                            style={{
                              marginTop: 4,
                              padding: '3px 8px',
                              borderRadius: 6,
                              border: '1px solid #38bdf8',
                              background: '#f0f9ff',
                              color: '#0284c7',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Camera size={11} /> Lihat Foto Nota
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Tanpa foto</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1e293b' }}>
                        {row.supplierName}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>
                        <div>{row.productName}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                          Batch: {row.batchCode}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#0284c7' }}>
                        {row.qty.toLocaleString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>
                        Rp {Math.round(row.costPrice).toLocaleString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                        Rp {Math.round(row.totalPrice).toLocaleString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {row.expiryDate ? (
                          <span style={{ fontWeight: 700, color: '#d97706' }}>{row.expiryDate}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {renderStatusBadge(row.status)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredTableRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1', fontWeight: 800, color: '#0f172a' }}>
                    <td colSpan={4} style={{ padding: '10px 12px' }}>
                      TOTAL RINGKASAN TABEL NOTA ({filteredTableRows.length} baris barang)
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#0284c7' }}>
                      {totalTableQty.toLocaleString('id-ID')} pcs
                    </td>
                    <td style={{ padding: '10px 12px' }} />
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#15803d', whiteSpace: 'nowrap' }}>
                      Rp {Math.round(totalTableAmount).toLocaleString('id-ID')}
                    </td>
                    <td colSpan={2} style={{ padding: '10px 12px' }} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : loading ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 16px',
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            color: '#64748b',
          }}
        >
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Memuat riwayat penerimaan barang...</p>
        </div>
      ) : errorMsg ? (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#b91c1c',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <AlertCircle size={20} />
          <span>{errorMsg}</span>
        </div>
      ) : drafts.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 16px',
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            color: '#64748b',
          }}
        >
          <Truck size={40} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', color: '#1e293b' }}>
            Belum Ada Penerimaan Barang
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#64748b' }}>
            {statusFilter === 'semua'
              ? 'Mulai catat kiriman barang supplier dengan menekan tombol input di atas.'
              : `Tidak ditemukan penerimaan berstatus "${statusFilter}".`}
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Upload & Input Nota Sekarang
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drafts.map((d) => (
            <div
              key={d.id}
              style={{
                background: '#ffffff',
                borderRadius: 12,
                border:
                  d.status === 'REVISED'
                    ? '1.5px solid #fb923c'
                    : d.status === 'APPROVED'
                      ? '1px solid #bbf7d0'
                      : '1px solid #e2e8f0',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      color: '#0f172a',
                      background: '#f1f5f9',
                      padding: '2px 8px',
                      borderRadius: 6,
                    }}
                  >
                    {d.receiveNumber}
                  </span>
                  {renderStatusBadge(d.status)}
                  {d.invoicePhotoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewPhotoUrl(d.invoicePhotoUrl || null);
                        setPreviewPhotoTitle(`${d.supplierName || 'Supplier'} — ${d.deliveryNote || d.receiveNumber}`);
                      }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        border: '1px solid #38bdf8',
                        background: '#f0f9ff',
                        color: '#0284c7',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Camera size={12} /> Foto Nota Tersimpan
                    </button>
                  )}
                </div>

                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {d.invoiceDate ? `Tgl Faktur: ${d.invoiceDate} • ` : ''}
                  {new Date(d.createdAt).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {/* Info Pengiriman */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: 8,
                  fontSize: '0.8rem',
                  color: '#334155',
                  background: '#f8fafc',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                <div>
                  <span style={{ color: '#64748b' }}>Supplier: </span>
                  <span style={{ fontWeight: 600 }}>{d.supplierName || '— (Umum)'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>No. Faktur / SJ: </span>
                  <span style={{ fontWeight: 600 }}>{d.deliveryNote || '—'}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>Petugas Penginput: </span>
                  <span style={{ fontWeight: 600 }}>
                    {d.creatorName} ({d.creatorNim})
                  </span>
                </div>
              </div>

              {/* Banner Catatan Manager jika ada (Revisi / Tolak) */}
              {d.managerNote && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: d.status === 'REVISED' ? '#fff7ed' : '#fef2f2',
                    border: d.status === 'REVISED' ? '1px solid #fed7aa' : '1px solid #fecaca',
                    fontSize: '0.8rem',
                    color: d.status === 'REVISED' ? '#c2410c' : '#b91c1c',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Catatan Manager: </strong>
                    <span>{d.managerNote}</span>
                  </div>
                </div>
              )}

              {/* Action Buttons Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 8,
                  paddingTop: 4,
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <button
                  type="button"
                  onClick={() => openDetailModal(d.id)}
                  style={{
                    minHeight: 44,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#334155',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Eye size={14} /> Rincian Item
                </button>

                {(d.status === 'DRAFT' || d.status === 'REVISED') && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditModal(d.id)}
                      style={{
                        minHeight: 44,
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: '1px solid #38bdf8',
                        background: '#f0f9ff',
                        color: '#0284c7',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Edit3 size={14} /> {d.status === 'REVISED' ? 'Perbaiki Draft' : 'Edit'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDirectSubmit(d.id)}
                      style={{
                        minHeight: 44,
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#0284c7',
                        color: '#ffffff',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 1px 3px rgba(2, 132, 199, 0.3)',
                      }}
                    >
                      <Send size={14} /> Ajukan ke Manager
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MODAL LIGHTBOX PREVIEW FOTO NOTA ── */}
      {previewPhotoUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              maxWidth: 680,
              width: '100%',
              maxHeight: '92dvh',
              overflowY: 'auto',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                📷 Foto Fisik Nota: {previewPhotoTitle}
              </h4>
              <button
                type="button"
                aria-label="Tutup foto nota"
                onClick={() => setPreviewPhotoUrl(null)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 8,
                  minWidth: 44,
                  minHeight: 44,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewPhotoUrl}
              alt={previewPhotoTitle}
              style={{
                width: '100%',
                maxHeight: '75dvh',
                objectFit: 'contain',
                borderRadius: 10,
                background: '#0f172a',
              }}
            />
          </div>
        </div>
      )}

      {/* ── MODAL RINCIAN DRAFT ── */}
      {viewingDraftId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 1050,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onClick={() => setViewingDraftId(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 640,
              width: '100%',
              maxHeight: '90dvh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              padding: '20px 18px',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                borderBottom: '1px solid #f1f5f9',
                paddingBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                  Rincian Nota Penerimaan Barang
                </h3>
                {detailData && (
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace' }}>
                    {detailData.receiveNumber}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Tutup rincian penerimaan"
                onClick={() => setViewingDraftId(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            {loadingDetail || !detailData ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                <p style={{ margin: 0, fontSize: '0.85rem' }}>Mengambil rincian produk...</p>
              </div>
            ) : (
              <>
                {/* Status & General Info */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: '#f8fafc',
                    padding: 12,
                    borderRadius: 10,
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Status Verifikasi:</span>
                    {renderStatusBadge(detailData.status)}
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Supplier: </span>
                    <strong>{detailData.supplierName || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Tanggal Faktur: </span>
                    <strong>{detailData.invoiceDate || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>No. Faktur / Surat Jalan: </span>
                    <strong>{detailData.deliveryNote || '—'}</strong>
                  </div>
                  {detailData.invoicePhotoUrl && (
                    <div style={{ marginTop: 4 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={detailData.invoicePhotoUrl}
                        alt="Foto Nota Supplier"
                        style={{
                          width: '100%',
                          maxHeight: 220,
                          objectFit: 'contain',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#0f172a',
                        }}
                      />
                    </div>
                  )}
                  {detailData.managerNote && (
                    <div style={{ color: '#c2410c', background: '#ffedd5', padding: 8, borderRadius: 6 }}>
                      <strong>Catatan Manager: </strong> {detailData.managerNote}
                    </div>
                  )}
                </div>

                {/* Table Items */}
                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                    Daftar Produk ({detailData.items.length} item):
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detailData.items.map((it, i) => (
                      <div
                        key={i}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          fontSize: '0.8rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontWeight: 700 }}>
                          <span>{it.productName}</span>
                          <span style={{ color: '#0284c7', flexShrink: 0 }}>
                            {it.qty} unit × Rp {Number(it.costPrice).toLocaleString('id-ID')} = Rp{' '}
                            {(it.qty * Number(it.costPrice)).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: '#64748b', fontSize: '0.75rem' }}>
                          <span>
                            Harga Satuan: <strong>Rp {Number(it.costPrice).toLocaleString('id-ID')}</strong>
                          </span>
                          <span>
                            Batch: <code style={{ color: '#475569' }}>{it.batchCode}</code>
                          </span>
                          <span>
                            Expired:{' '}
                            <strong style={{ color: it.expiryDate ? '#d97706' : '#64748b' }}>
                              {it.expiryDate || 'Tanpa Expired'}
                            </strong>
                          </span>
                        </div>
                        {it.conditionNote && (
                          <div style={{ fontSize: '0.75rem', color: '#475569', fontStyle: 'italic' }}>
                            Catatan: {it.conditionNote}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Modal Footer Actions */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                    gap: 8,
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setViewingDraftId(null)}
                    style={{
                      minHeight: 44,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Tutup
                  </button>

                  {(detailData.status === 'DRAFT' || detailData.status === 'REVISED') && (
                    <button
                      type="button"
                      onClick={() => handleDirectSubmit(detailData.id)}
                      style={{
                        minHeight: 44,
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#0284c7',
                        color: '#ffffff',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Send size={14} /> Ajukan ke Manager
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL FORM (INPUT / EDIT NOTA SUPPLIER + 5 OTOMATISASI) ── */}
      {isFormOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(5px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 780,
              width: '100%',
              maxHeight: '94dvh',
              overflowY: 'auto',
              boxShadow: '0 25px 30px -5px rgba(0, 0, 0, 0.2)',
              padding: '20px 18px',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {/* Header Form */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                borderBottom: '1px solid #f1f5f9',
                paddingBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  {editingDraftId ? 'Edit Nota Penerimaan Supplier' : 'Upload & Input Nota Supplier'}
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Simpan foto fisik nota, tanggal faktur, kuantiti, harga, & expired date dalam satu tempat.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup form penerimaan"
                onClick={() => setIsFormOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={22} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            {smartMatchFeedback && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#15803d',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Sparkles size={16} />
                <span>{smartMatchFeedback}</span>
              </div>
            )}

            {/* ── OTOMATISASI 3: UPLOAD FOTO FISIK NOTA + PREVIEW ── */}
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px dashed #94a3b8',
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={16} color="#0284c7" /> Foto Fisik Nota / Faktur Supplier
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                    Otomatis dikompres ringan oleh browser agar tersimpan permanen di sistem.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id={photoUploadId}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadInvoicePhoto}
                    style={{ display: 'none' }}
                  />
                  <label
                    htmlFor={photoUploadId}
                    style={{
                      minHeight: 44,
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: '#0284c7',
                      color: '#ffffff',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Camera size={14} /> {uploadingPhoto ? 'Mengompres Foto...' : invoicePhotoUrl ? 'Ganti Foto Nota' : 'Upload / Foto Nota'}
                  </label>
                  {invoicePhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setInvoicePhotoUrl(null)}
                      style={{
                        minHeight: 44,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#dc2626',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Hapus Foto
                    </button>
                  )}
                </div>
              </div>

              {invoicePhotoUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={invoicePhotoUrl}
                    alt="Preview Nota Supplier"
                    style={{
                      width: '100%',
                      maxHeight: 210,
                      objectFit: 'contain',
                      borderRadius: 8,
                      background: '#0f172a',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 600 }}>
                    ✅ Foto nota siap disimpan. Anda bisa membaca angka di foto ini sambil mengecek tabel di bawah.
                  </span>
                </div>
              )}
            </div>

            {/* Input Informasi Pengiriman (Supplier, Tanggal Faktur, No. Faktur) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    Nama Supplier / Distributor *
                  </label>
                  {registeredSuppliers.length > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      Pilih atau ketik
                    </span>
                  )}
                </div>

                {registeredSuppliers.length > 0 && (
                  <select
                    aria-label="Pilih Pemasok Terdaftar"
                    value={registeredSuppliers.some((s) => s.name === supplierName) ? supplierName : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSupplierName(e.target.value);
                      }
                    }}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 'var(--text-base)',
                      backgroundColor: '#f8fafc',
                      color: '#1e293b',
                      marginBottom: 6,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">-- Pilih dari Pemasok Terdaftar (Opsional) --</option>
                    {registeredSuppliers.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} {s.contactPerson ? `(${s.contactPerson})` : ''}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  placeholder="Ketik nama supplier (misal: PT Indofood / Roti Mandiri)"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--text-base)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Tanggal Faktur Nota *
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--text-base)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Nomor Faktur / Surat Jalan
                </label>
                <input
                  type="text"
                  placeholder="Contoh: FK-2026/XI/0091"
                  value={deliveryNote}
                  onChange={(e) => setDeliveryNote(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--text-base)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* ── OTOMATISASI 1: BANNER AUTO-FILL DARI RIWAYAT SUPPLIER ── */}
            {supplierHistoryItems.length > 0 && (
              <div
                style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 10,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: '0.78rem', color: '#1e3a8a' }}>
                  <strong>Riwayat Faktur Pemasok:</strong> Tersedia{' '}
                  <strong>{supplierHistoryItems.length} item produk terdaftar</strong> beserta harga beli terakhir dari{' '}
                  <strong>{supplierName}</strong>.
                </div>
                <button
                  type="button"
                  onClick={handleAutoFillFromSupplierHistory}
                  style={{
                    minHeight: 44,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Sparkles size={14} /> Muat Daftar Produk Sebelumnya
                </button>
              </div>
            )}

            {/* ── OTOMATISASI 2: PANEL PENCOCOKAN OTOMATIS TEKS FAKTUR ── */}
            <div
              style={{
                background: '#faf5ff',
                border: '1px solid #e9d5ff',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#581c87', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={15} color="#7e22ce" /> Pencocokan Otomatis Rincian Faktur (Ekstraksi Teks ke Katalog Produk)
                </div>
                <button
                  type="button"
                  onClick={() => setIsSmartMatcherOpen((prev) => !prev)}
                  style={{
                    minHeight: 44,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #c084fc',
                    background: '#ffffff',
                    color: '#6b21a8',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isSmartMatcherOpen ? 'Tutup Panel Ekstraksi' : 'Buka Ekstraksi Teks Faktur'}
                </button>
              </div>

              {isSmartMatcherOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: '0.74rem', color: '#6b21a8' }}>
                    Tempelkan rincian daftar barang dari dokumen faktur pemasok (satu baris per produk, contoh: <code>Indomie Goreng 40 3100 2027-05-10</code>). Sistem akan memetakan nama produk, kuantitas, harga satuan, dan tanggal kedaluwarsa secara otomatis.
                  </p>
                  <textarea
                    rows={4}
                    placeholder={'Contoh format baris:\nSupplier: PT Indofood Sukses Makmur\nNo Faktur: FK-2026-0912\nIndomie Goreng 40 3100 2027-05-10\nTeh Pucuk Harum 24 2800'}
                    value={smartPasteText}
                    onChange={(e) => setSmartPasteText(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid #d8b4fe',
                      fontSize: 'var(--text-base)',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleSmartMatchNotaText}
                      style={{
                        minHeight: 44,
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#7e22ce',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Sparkles size={14} /> Proses & Petakan ke Tabel Produk
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Daftar Produk yang Diterima */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e293b' }}>
                  Tabel Rincian Barang Nota ({items.length} item)
                </label>

                <button
                  type="button"
                  onClick={() => setIsProductPickerOpen(true)}
                  style={{
                    minHeight: 44,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #0284c7',
                    background: '#f0f9ff',
                    color: '#0284c7',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Plus size={15} /> + Pilih Produk SKU Manual
                </button>
              </div>

              {items.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    background: '#f8fafc',
                    borderRadius: 10,
                    border: '1.5px dashed #cbd5e1',
                    color: '#64748b',
                  }}
                >
                  <Layers size={28} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
                  <p style={{ margin: '0 0 6px 0', fontSize: '0.82rem', fontWeight: 600 }}>
                    Belum ada produk di nota ini
                  </p>
                  <p style={{ margin: 0, fontSize: '0.75rem' }}>
                    Gunakan tombol <strong>Auto-Match</strong> di atas atau klik <strong>+ Pilih Produk SKU Manual</strong>.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map((it, idx) => {
                    const prodMeta = productsList.find((p) => p.id === it.productId);
                    const isPerishable = prodMeta?.isPerishable;
                    const lineTotal = (Number(it.qty) || 0) * (Number(it.costPrice) || 0);

                    return (
                      <div
                        key={idx}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                              #{idx + 1} {it.productName}
                            </span>
                            {isPerishable && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: '0.7rem',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: '#dcfce7',
                                  color: '#15803d',
                                  fontWeight: 700,
                                }}
                              >
                                Basah / Perishable
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0284c7', background: '#f0f9ff', padding: '4px 8px', borderRadius: 6 }}>
                              Subtotal: Rp {Math.round(lineTotal).toLocaleString('id-ID')}
                            </span>
                            <button
                              type="button"
                              aria-label={`Hapus ${it.productName}`}
                              onClick={() => handleRemoveItem(idx)}
                              style={{
                                background: '#fee2e2',
                                border: 'none',
                                color: '#dc2626',
                                minWidth: 44,
                                minHeight: 44,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 8,
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                              title="Hapus Item"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                            gap: 8,
                          }}
                        >
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>
                              Kuantiti (Qty Unit)
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={it.qty}
                              onChange={(e) => handleUpdateItem(idx, 'qty', parseInt(e.target.value || '1', 10))}
                              style={{
                                width: '100%',
                                minHeight: 44,
                                padding: '8px 10px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: 'var(--text-base)',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <label style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                Harga Satuan (Rp)
                              </label>
                              {it.qty > 1 && it.costPrice >= it.qty * 500 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateItem(idx, 'costPrice', Math.round(it.costPrice / it.qty))
                                  }
                                  title="Jika yang Anda ketik adalah harga 1 kardus/total, klik untuk membagi otomatis menjadi harga per pcs"
                                  style={{
                                    border: 'none',
                                    background: '#e0f2fe',
                                    color: '#0369a1',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 2,
                                  }}
                                >
                                  <Calculator size={10} /> ÷{it.qty} (Rp {Math.round(it.costPrice / it.qty).toLocaleString('id-ID')}/pcs)
                                </button>
                              )}
                            </div>
                            <input
                              type="number"
                              min={0}
                              value={it.costPrice}
                              onChange={(e) => handleUpdateItem(idx, 'costPrice', parseFloat(e.target.value || '0'))}
                              style={{
                                width: '100%',
                                minHeight: 44,
                                padding: '8px 10px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: 'var(--text-base)',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <label style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                Tanggal Expired {isPerishable && <span style={{ color: '#ef4444' }}>*Wajib</span>}
                              </label>
                              <div style={{ display: 'inline-flex', gap: 3 }}>
                                {[1, 2, 7].map((dNum) => (
                                  <button
                                    key={dNum}
                                    type="button"
                                    onClick={() => handleUpdateItem(idx, 'expiryDate', addDaysToToday(dNum))}
                                    style={{
                                      border: '1px solid #cbd5e1',
                                      background: '#f8fafc',
                                      color: '#475569',
                                      fontSize: '0.62rem',
                                      fontWeight: 700,
                                      padding: '1px 4px',
                                      borderRadius: 4,
                                      cursor: 'pointer',
                                    }}
                                    title={`Isi otomatis +${dNum} hari dari hari ini`}
                                  >
                                    +{dNum}h
                                  </button>
                                ))}
                              </div>
                            </div>
                            <input
                              type="date"
                              value={it.expiryDate || ''}
                              onChange={(e) => handleUpdateItem(idx, 'expiryDate', e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: 44,
                                padding: '8px 10px',
                                borderRadius: 6,
                                border: isPerishable && !it.expiryDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                                fontSize: 'var(--text-base)',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>
                              Kode Batch Masuk
                            </label>
                            <input
                              type="text"
                              value={it.batchCode}
                              onChange={(e) => handleUpdateItem(idx, 'batchCode', e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: 44,
                                padding: '8px 10px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: 'var(--text-base)',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder="Catatan kondisi fisik (contoh: segel utuh, kemasan tidak penyok)"
                            value={it.conditionNote || ''}
                            onChange={(e) => handleUpdateItem(idx, 'conditionNote', e.target.value)}
                            style={{
                              width: '100%',
                              minHeight: 44,
                              padding: '8px 10px',
                              borderRadius: 6,
                              border: '1px solid #e2e8f0',
                              fontSize: 'var(--text-base)',
                              boxSizing: 'border-box',
                              background: '#f8fafc',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* ── OTOMATISASI 4: KOTAK RINGKASAN GRAND TOTAL FAKTUR ── */}
                  <div
                    style={{
                      background: '#f0fdf4',
                      border: '1.5px solid #86efac',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Calendar size={15} /> Ringkasan Nota ({items.length} jenis barang • Total {totalFormQty.toLocaleString('id-ID')} pcs)
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#15803d' }}>
                      Total Faktur: Rp {Math.round(totalFormAmount).toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tombol Aksi Form */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
                gap: 8,
                borderTop: '1px solid #f1f5f9',
                paddingTop: 14,
              }}
            >
              <button
                type="button"
                disabled={submittingForm}
                onClick={() => setIsFormOpen(false)}
                style={{
                  minHeight: 44,
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>

              <button
                type="button"
                disabled={submittingForm || items.length === 0}
                onClick={() => handleSubmitForm(false)}
                style={{
                  minHeight: 44,
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #0284c7',
                  background: '#f0f9ff',
                  color: '#0284c7',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Simpan Nota (Draft)
              </button>

              <button
                type="button"
                disabled={submittingForm || items.length === 0}
                onClick={() => handleSubmitForm(true)}
                style={{
                  minHeight: 44,
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                }}
              >
                <Send size={14} /> Simpan Nota & Langsung Ajukan ACC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL PRODUCT PICKER ── */}
      {isProductPickerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onClick={() => setIsProductPickerOpen(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 14,
              maxWidth: 480,
              width: '100%',
              maxHeight: '85dvh',
              overflowY: 'auto',
              padding: 16,
              paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800 }}>Pilih Produk SKU</h4>
              <button
                type="button"
                aria-label="Tutup pilihan produk SKU"
                onClick={() => setIsProductPickerOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                id={modalSearchId}
                type="text"
                placeholder="Cari nama produk atau barcode..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '8px 12px 8px 36px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--text-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50dvh', overflowY: 'auto' }}>
              {filteredProductOptions.slice(0, 50).map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => handleSelectProduct(prod)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    minHeight: 48,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #f1f5f9',
                    background: '#f8fafc',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>{prod.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {prod.categoryName} • Stok Sekarang: {prod.stockQty} {prod.unit}
                    </div>
                  </div>
                  <ChevronRight size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
