'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import type {
  ExpenseCategory,
  PurchaseReceiptCategory,
  PurchaseReceiptUploaderRole,
} from '@/lib/db/schema';

type PortalRole = 'MANAGER' | 'ADMIN_SHIFT' | 'GUDANG';

type ReceiptItem = {
  id: string;
  receiptDate: string | null;
  category: PurchaseReceiptCategory;
  merchantName: string;
  invoiceNumber: string | null;
  paymentStatus: string | null;
  totalAmount: number | null;
  stockAmount: number | null;
  operationalAmount: number | null;
  consignmentAmount: number | null;
  operationalItems: string | null;
  description: string | null;
  sourceFolder: string | null;
  sourceFilename: string | null;
  imageUrl: string | null;
  uploadedByRole: PurchaseReceiptUploaderRole;
  uploadedByName: string;
  linkedExpenseId: string | null;
  isVerified: boolean;
  createdAt: string;
};

type ManagerSummary = {
  totalReceipts: number;
  totalBelanjaStok: number;
  totalReseller: number;
  totalOperasional: number;
  totalTitipan: number;
  syncedOpexCount: number;
};

type ApiResponseData = {
  viewerRole: PortalRole;
  canManage: boolean;
  items: ReceiptItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  categoryCounts: Record<string, number>;
  availableMonths: Array<{ month: string; count: number }>;
  summary: ManagerSummary | null;
};

type FilterCategory = 'FINANCIAL' | 'ALL' | PurchaseReceiptCategory;

const CATEGORY_META: Record<
  PurchaseReceiptCategory,
  { label: string; bg: string; fg: string; border: string }
> = {
  BELANJA_STOK: {
    label: 'Belanja Stok',
    bg: 'hsl(142 76% 94%)',
    fg: 'hsl(142 72% 24%)',
    border: 'hsl(142 55% 78%)',
  },
  RESELLER_LUNAS: {
    label: 'Reseller Lunas',
    bg: 'hsl(214 95% 94%)',
    fg: 'hsl(221 76% 32%)',
    border: 'hsl(214 78% 80%)',
  },
  OPERASIONAL: {
    label: 'Operasional',
    bg: 'hsl(38 92% 93%)',
    fg: 'hsl(28 84% 28%)',
    border: 'hsl(38 80% 76%)',
  },
  TITIPAN_MITRA: {
    label: 'Titipan Mitra',
    bg: 'hsl(270 90% 95%)',
    fg: 'hsl(271 65% 34%)',
    border: 'hsl(270 65% 82%)',
  },
  CAMPURAN: {
    label: 'Campuran',
    bg: 'hsl(188 86% 93%)',
    fg: 'hsl(192 78% 26%)',
    border: 'hsl(188 62% 76%)',
  },
  PENJUALAN_BUKU: {
    label: 'Buku Penjualan',
    bg: 'hsl(210 30% 94%)',
    fg: 'hsl(215 28% 30%)',
    border: 'hsl(214 24% 82%)',
  },
  ABSENSI_JAGA: {
    label: 'Absensi Jaga',
    bg: 'hsl(330 85% 95%)',
    fg: 'hsl(333 70% 34%)',
    border: 'hsl(330 62% 82%)',
  },
  LAINNYA: {
    label: 'Lainnya',
    bg: 'hsl(220 14% 94%)',
    fg: 'hsl(220 18% 34%)',
    border: 'hsl(220 14% 82%)',
  },
};

const UPLOAD_CATEGORIES: Array<{ value: PurchaseReceiptCategory; label: string }> = [
  { value: 'BELANJA_STOK', label: 'Nota Belanja Stok / Kulakan' },
  { value: 'RESELLER_LUNAS', label: 'Nota Reseller Lunas' },
  { value: 'OPERASIONAL', label: 'Nota Operasional (Plastik / ATK / Parkir)' },
  { value: 'TITIPAN_MITRA', label: 'Catatan Titipan / Konsinyasi Mitra' },
  { value: 'CAMPURAN', label: 'Nota Campuran (Stok + Operasional / Titipan)' },
  { value: 'PENJUALAN_BUKU', label: 'Buku Catatan Penjualan' },
  { value: 'ABSENSI_JAGA', label: 'Buku Absensi Jaga Shift' },
  { value: 'LAINNYA', label: 'Dokumen / Nota Lainnya' },
];

const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'PLASTIK_KEMASAN', label: 'Plastik & Kemasan' },
  { value: 'TRANSPORT', label: 'Transport / Parkir / Bensin' },
  { value: 'LISTRIK', label: 'Listrik & Air' },
  { value: 'LAINNYA', label: 'ATK & Operasional Lainnya' },
  { value: 'KERUGIAN_BARANG', label: 'Kerugian Barang' },
  { value: 'HONOR', label: 'Honor' },
  { value: 'SEWA', label: 'Sewa' },
  { value: 'FEE_QRIS_BANK', label: 'Fee QRIS / Bank' },
];

const ROLE_LABELS: Record<PurchaseReceiptUploaderRole, string> = {
  MANAGER: 'Manager',
  ADMIN_SHIFT: 'Admin Shift',
  GUDANG: 'Petugas Gudang',
  SYSTEM_IMPORT: 'Arsip Gelombang 2',
};

function formatRp(amount: number | null | undefined): string {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatDateId(dateStr: string | null): string {
  if (!dateStr) return 'Tanpa Tanggal';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getTodayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function scopeHeaderFor(role: PortalRole): string {
  if (role === 'MANAGER') return 'manager';
  if (role === 'ADMIN_SHIFT') return 'admin';
  return 'gudang';
}

type NotaBelanjaPanelProps = {
  portalRole: PortalRole;
  onOpexSynced?: () => void;
};

export default function NotaBelanjaPanel({ portalRole, onOpexSynced }: NotaBelanjaPanelProps) {
  const uid = useId();
  const scopeHeader = scopeHeaderFor(portalRole);
  const isManager = portalRole === 'MANAGER';
  const isGudang = portalRole === 'GUDANG';

  // Filters & pagination
  const [category, setCategory] = useState<FilterCategory>('FINANCIAL');
  const [month, setMonth] = useState<string>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadSeq, setReloadSeq] = useState(0);

  // Data state
  const [data, setData] = useState<ApiResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Modals
  const [viewingItem, setViewingItem] = useState<ReceiptItem | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ReceiptItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<ReceiptItem | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [upDate, setUpDate] = useState<string>(() => getTodayWib());
  const [upCategory, setUpCategory] = useState<PurchaseReceiptCategory>('BELANJA_STOK');
  const [upMerchant, setUpMerchant] = useState('');
  const [upInvoice, setUpInvoice] = useState('');
  const [upPayStatus, setUpPayStatus] = useState<'LUNAS' | 'BELUM_LUNAS' | 'CAMPURAN' | 'INFO'>('LUNAS');
  const [upTotal, setUpTotal] = useState('');
  const [upOpexAmt, setUpOpexAmt] = useState('');
  const [upOpexItems, setUpOpexItems] = useState('');
  const [upDesc, setUpDesc] = useState('');
  const [upSyncOpex, setUpSyncOpex] = useState(false);
  const [upExpCat, setUpExpCat] = useState<ExpenseCategory>('PLASTIK_KEMASAN');
  const [submittingUpload, setSubmittingUpload] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manager edit modal state
  const [edDate, setEdDate] = useState('');
  const [edCategory, setEdCategory] = useState<PurchaseReceiptCategory>('BELANJA_STOK');
  const [edMerchant, setEdMerchant] = useState('');
  const [edInvoice, setEdInvoice] = useState('');
  const [edPayStatus, setEdPayStatus] = useState<'LUNAS' | 'BELUM_LUNAS' | 'CAMPURAN' | 'INFO'>('LUNAS');
  const [edTotal, setEdTotal] = useState('');
  const [edStock, setEdStock] = useState('');
  const [edOpex, setEdOpex] = useState('');
  const [edConsign, setEdConsign] = useState('');
  const [edOpexItems, setEdOpexItems] = useState('');
  const [edDesc, setEdDesc] = useState('');
  const [edVerified, setEdVerified] = useState(true);
  const [edSyncOpex, setEdSyncOpex] = useState(false);
  const [edExpCat, setEdExpCat] = useState<ExpenseCategory>('PLASTIK_KEMASAN');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Manager delete modal state
  const [deleteReason, setDeleteReason] = useState('');
  const [submittingDelete, setSubmittingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ESC closes active modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deletingItem) setDeletingItem(null);
      else if (editingItem) setEditingItem(null);
      else if (showUploadModal) setShowUploadModal(false);
      else if (viewingItem) setViewingItem(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deletingItem, editingItem, showUploadModal, viewingItem]);

  // Revoke object URL on preview change/unmount
  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchReceipts() {
      setLoading(true);
      setErrorMsg('');
      try {
        const qs = new URLSearchParams({
          category,
          month,
          page: String(page),
          limit: '24',
        });
        if (debouncedSearch) qs.set('search', debouncedSearch);

        const res = await fetch(`/api/nota-belanja?${qs.toString()}`, {
          headers: { 'x-portal-scope': scopeHeader },
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          success?: boolean;
          data?: ApiResponseData;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.success || !json.data) {
          setErrorMsg(typeof json.error === 'string' ? json.error : 'Gagal memuat arsip nota.');
          return;
        }
        setData(json.data);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setErrorMsg('Koneksi terganggu saat memuat arsip nota. Coba muat ulang.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchReceipts();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [category, month, debouncedSearch, page, reloadSeq, scopeHeader]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((curr) => (curr === msg ? '' : curr)), 4000);
  }, []);

  function resetUploadForm() {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadFile(null);
    setUploadPreviewUrl(null);
    setUpDate(getTodayWib());
    setUpCategory('BELANJA_STOK');
    setUpMerchant('');
    setUpInvoice('');
    setUpPayStatus('LUNAS');
    setUpTotal('');
    setUpOpexAmt('');
    setUpOpexItems('');
    setUpDesc('');
    setUpSyncOpex(false);
    setUpExpCat('PLASTIK_KEMASAN');
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFileChange(file: File | null) {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    if (!file) {
      setUploadFile(null);
      setUploadPreviewUrl(null);
      return;
    }
    setUploadFile(file);
    setUploadPreviewUrl(URL.createObjectURL(file));
    setUploadError('');
  }

  async function handleSubmitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError('Pilih atau ambil foto nota terlebih dahulu.');
      return;
    }
    if (upMerchant.trim().length < 2) {
      setUploadError('Nama toko / mitra wajib diisi (minimal 2 karakter).');
      return;
    }

    setSubmittingUpload(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('foto', uploadFile);
      fd.append('receiptDate', upDate || getTodayWib());
      fd.append('category', upCategory);
      fd.append('merchantName', upMerchant.trim());
      if (upInvoice.trim()) fd.append('invoiceNumber', upInvoice.trim());
      fd.append('paymentStatus', upPayStatus);
      if (!isGudang) {
        const totalNum = Math.max(0, parseInt(upTotal.replace(/\D/g, ''), 10) || 0);
        const opexNum = Math.max(0, parseInt(upOpexAmt.replace(/\D/g, ''), 10) || 0);
        fd.append('totalAmount', String(totalNum));
        if (opexNum > 0) fd.append('operationalAmount', String(opexNum));
      }
      if (upOpexItems.trim()) fd.append('operationalItems', upOpexItems.trim());
      if (upDesc.trim()) fd.append('description', upDesc.trim());
      if (isManager && upSyncOpex) {
        fd.append('syncToOpex', 'true');
        fd.append('expenseCategory', upExpCat);
      }

      const res = await fetch('/api/nota-belanja', {
        method: 'POST',
        headers: { 'x-portal-scope': scopeHeader },
        body: fd,
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        setUploadError(typeof json.error === 'string' ? json.error : 'Gagal mengunggah nota.');
        return;
      }

      const syncedNow = isManager && upSyncOpex;
      resetUploadForm();
      setShowUploadModal(false);
      setPage(1);
      setReloadSeq((n) => n + 1);
      if (syncedNow && onOpexSynced) onOpexSynced();
      showToast('Foto nota berhasil diunggah dan tersimpan di arsip.');
    } catch {
      setUploadError('Gagal terhubung ke server. Periksa koneksi Wi-Fi Anda.');
    } finally {
      setSubmittingUpload(false);
    }
  }

  function openEditModal(item: ReceiptItem) {
    setEditingItem(item);
    setEdDate(item.receiptDate ?? '');
    setEdCategory(item.category);
    setEdMerchant(item.merchantName);
    setEdInvoice(item.invoiceNumber ?? '');
    setEdPayStatus(
      item.paymentStatus === 'BELUM_LUNAS' ||
        item.paymentStatus === 'CAMPURAN' ||
        item.paymentStatus === 'INFO'
        ? item.paymentStatus
        : 'LUNAS',
    );
    setEdTotal(String(item.totalAmount ?? 0));
    setEdStock(String(item.stockAmount ?? 0));
    setEdOpex(String(item.operationalAmount ?? 0));
    setEdConsign(String(item.consignmentAmount ?? 0));
    setEdOpexItems(item.operationalItems ?? '');
    setEdDesc(item.description ?? '');
    setEdVerified(item.isVerified);
    setEdSyncOpex(false);
    setEdExpCat('PLASTIK_KEMASAN');
    setEditError('');
  }

  async function handleSubmitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;
    setSubmittingEdit(true);
    setEditError('');
    try {
      const parseNum = (v: string) => Math.max(0, parseInt(v.replace(/\D/g, ''), 10) || 0);
      const res = await fetch(`/api/nota-belanja/${editingItem.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-portal-scope': 'manager',
        },
        body: JSON.stringify({
          receiptDate: edDate.trim() || null,
          category: edCategory,
          merchantName: edMerchant.trim(),
          invoiceNumber: edInvoice.trim() || null,
          paymentStatus: edPayStatus,
          totalAmount: parseNum(edTotal),
          stockAmount: parseNum(edStock),
          operationalAmount: parseNum(edOpex),
          consignmentAmount: parseNum(edConsign),
          operationalItems: edOpexItems.trim() || null,
          description: edDesc.trim() || null,
          isVerified: edVerified,
          syncToOpex: edSyncOpex && !editingItem.linkedExpenseId,
          expenseCategory: edExpCat,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        setEditError(typeof json.error === 'string' ? json.error : 'Gagal memperbarui nota.');
        return;
      }
      const syncedNow = edSyncOpex && !editingItem.linkedExpenseId;
      setEditingItem(null);
      setReloadSeq((n) => n + 1);
      if (syncedNow && onOpexSynced) onOpexSynced();
      showToast(
        syncedNow
          ? 'Nota diperbarui dan disinkronkan ke Biaya Operasional.'
          : 'Data arsip nota berhasil diperbarui.',
      );
    } catch {
      setEditError('Koneksi terganggu. Coba lagi.');
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleConfirmDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deletingItem) return;
    setSubmittingDelete(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/nota-belanja/${deletingItem.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-portal-scope': 'manager',
        },
        body: JSON.stringify({
          reason: deleteReason.trim() || 'Dihapus oleh Manager dari arsip nota',
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        setDeleteError(typeof json.error === 'string' ? json.error : 'Gagal menghapus nota.');
        return;
      }
      setDeletingItem(null);
      setDeleteReason('');
      setReloadSeq((n) => n + 1);
      showToast('Arsip nota berhasil dihapus (soft-delete).');
    } catch {
      setDeleteError('Koneksi terganggu. Coba lagi.');
    } finally {
      setSubmittingDelete(false);
    }
  }

  const categoryChips = useMemo(() => {
    const counts = data?.categoryCounts ?? {};
    return [
      { id: 'FINANCIAL' as const, label: `Nota Belanja & Operasional (${counts.FINANCIAL ?? 0})` },
      { id: 'ALL' as const, label: `Semua Arsip (${counts.ALL ?? 0})` },
      { id: 'BELANJA_STOK' as const, label: `Belanja Stok (${counts.BELANJA_STOK ?? 0})` },
      { id: 'RESELLER_LUNAS' as const, label: `Reseller Lunas (${counts.RESELLER_LUNAS ?? 0})` },
      { id: 'OPERASIONAL' as const, label: `Operasional (${counts.OPERASIONAL ?? 0})` },
      { id: 'TITIPAN_MITRA' as const, label: `Titipan Mitra (${counts.TITIPAN_MITRA ?? 0})` },
      { id: 'CAMPURAN' as const, label: `Campuran (${counts.CAMPURAN ?? 0})` },
      { id: 'PENJUALAN_BUKU' as const, label: `Buku Penjualan (${counts.PENJUALAN_BUKU ?? 0})` },
      { id: 'ABSENSI_JAGA' as const, label: `Absensi Jaga (${counts.ABSENSI_JAGA ?? 0})` },
    ];
  }, [data?.categoryCounts]);

  const roleSubtitle = isManager
    ? 'Akses penuh Manager: lihat semua foto nota, total nominal, edit, sinkronisasi ke Biaya Operasional, dan kelola arsip.'
    : portalRole === 'ADMIN_SHIFT'
    ? 'Unggah foto nota belanja/titipan harian serta pantau galeri bukti foto dan keterangannya.'
    : 'Unggah foto nota belanja/barang masuk serta lihat arsip foto dan keterangannya.';

  return (
    <section aria-labelledby={`${uid}-heading`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Header & Primary Upload CTA ── */}
      <div
        className="card"
        style={{
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 220, flex: '1 1 280px' }}>
          <h2
            id={`${uid}-heading`}
            style={{
              margin: 0,
              fontSize: '1.02rem',
              fontWeight: 800,
              color: 'var(--color-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Receipt size={18} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
            <span>Arsip Nota Belanja &amp; Operasional</span>
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
            {roleSubtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            resetUploadForm();
            setShowUploadModal(true);
          }}
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 42,
            padding: '0 16px',
            borderRadius: 10,
            fontWeight: 700,
            fontSize: '0.84rem',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Unggah Foto Nota</span>
        </button>
      </div>

      {/* ── Toast Notification ── */}
      {toastMsg && (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            backgroundColor: 'hsl(142 76% 94%)',
            border: '1px solid hsl(142 55% 74%)',
            color: 'hsl(142 72% 22%)',
            fontSize: '0.82rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={16} aria-hidden="true" />
            {toastMsg}
          </span>
          <button
            type="button"
            onClick={() => setToastMsg('')}
            aria-label="Tutup notifikasi"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Manager-Only Financial KPI Grid ── */}
      {isManager && data?.summary && (
        <div className="rep-kpi-grid">
          <article className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Total Arsip Foto</span>
              <ImageIcon size={15} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
            </div>
            <div className="rep-kpi__val" style={{ color: 'var(--color-primary)' }}>
              {data.summary.totalReceipts.toLocaleString('id-ID')}
            </div>
            <div className="rep-kpi__sub">
              {data.summary.syncedOpexCount} nota tersinkron ke Biaya Operasional
            </div>
          </article>

          <article className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Nota Belanja Stok</span>
              <Receipt size={15} style={{ color: 'hsl(142 72% 32%)' }} aria-hidden="true" />
            </div>
            <div className="rep-kpi__val">{formatRp(data.summary.totalBelanjaStok)}</div>
            <div className="rep-kpi__sub">Kulakan &amp; belanja rutin</div>
          </article>

          <article className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Nota Reseller Lunas</span>
              <Wallet size={15} style={{ color: 'hsl(221 76% 42%)' }} aria-hidden="true" />
            </div>
            <div className="rep-kpi__val" style={{ color: 'hsl(221 76% 36%)' }}>
              {formatRp(data.summary.totalReseller)}
            </div>
            <div className="rep-kpi__sub">Stok supplier &amp; reseller</div>
          </article>

          <article className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Operasional &amp; Titipan</span>
              <Sparkles size={15} style={{ color: 'hsl(28 84% 40%)' }} aria-hidden="true" />
            </div>
            <div className="rep-kpi__val" style={{ color: 'hsl(28 84% 34%)' }}>
              {formatRp(data.summary.totalOperasional)}
            </div>
            <div className="rep-kpi__sub">
              Titipan mitra: {formatRp(data.summary.totalTitipan)}
            </div>
          </article>
        </div>
      )}

      {/* ── Search, Month & Category Filter Bar ── */}
      <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search
              size={15}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-muted)',
              }}
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama toko, mitra, barang, atau pengunggah..."
              aria-label="Cari arsip nota"
              className="form-input"
              style={{ width: '100%', paddingLeft: 34, minHeight: 40, fontSize: '0.84rem' }}
            />
          </div>

          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
            aria-label="Filter bulan nota"
            className="form-input"
            style={{ width: 'auto', minWidth: 175, minHeight: 40, fontSize: '0.84rem', fontWeight: 600 }}
          >
            <option value="ALL">Semua Bulan</option>
            {(data?.availableMonths ?? []).map((m) => (
              <option key={m.month} value={m.month}>
                {formatMonthLabel(m.month)} ({m.count})
              </option>
            ))}
          </select>
        </div>

        <div className="rep-chip-bar" role="group" aria-label="Filter kategori nota">
          {categoryChips.map((chip) => {
            const active = category === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={`rep-chip${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  setCategory(chip.id);
                  setPage(1);
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Error State ── */}
      {errorMsg && (
        <div className="alert alert-error" role="alert">
          {errorMsg}
        </div>
      )}

      {/* ── Gallery Grid ── */}
      {loading && !data ? (
        <div
          className="card"
          style={{
            padding: '48px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            color: 'var(--color-text-muted)',
          }}
        >
          <Loader2 size={26} className="spin-icon" aria-hidden="true" />
          <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>Memuat galeri arsip nota...</span>
        </div>
      ) : data && data.items.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '44px 16px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <FileText size={32} aria-hidden="true" style={{ opacity: 0.5 }} />
          <div style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: '0.92rem' }}>
            Belum ada nota untuk filter ini
          </div>
          <div style={{ fontSize: '0.78rem', maxWidth: 360 }}>
            Coba ubah kategori/bulan atau klik tombol &ldquo;Unggah Foto Nota&rdquo; untuk menambahkan bukti baru.
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
              gap: 14,
              opacity: loading ? 0.65 : 1,
              transition: 'opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {(data?.items ?? []).map((item) => {
              const catMeta = CATEGORY_META[item.category] ?? CATEGORY_META.LAINNYA;
              return (
                <article
                  key={item.id}
                  className="card"
                  style={{
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {/* Thumbnail button -> Lightbox */}
                  <button
                    type="button"
                    onClick={() => setViewingItem(item)}
                    aria-label={`Lihat foto nota ${item.merchantName}`}
                    style={{
                      position: 'relative',
                      width: '100%',
                      aspectRatio: '4 / 3',
                      backgroundColor: 'hsl(210 20% 95%)',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      display: 'block',
                    }}
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={`Foto nota ${item.merchantName}`}
                        loading="lazy"
                        decoding="async"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        <ImageIcon size={32} aria-hidden="true" />
                      </div>
                    )}

                    {/* Top badges overlay */}
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        backgroundColor: catMeta.bg,
                        color: catMeta.fg,
                        border: `1px solid ${catMeta.border}`,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                      }}
                    >
                      {catMeta.label}
                    </span>

                    <span
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        right: 8,
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(15, 23, 42, 0.78)',
                        color: '#ffffff',
                      }}
                    >
                      {formatDateId(item.receiptDate)}
                    </span>
                  </button>

                  {/* Card content */}
                  <div
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      flex: 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: '0.88rem',
                          fontWeight: 800,
                          color: 'var(--color-text)',
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {item.merchantName}
                      </h3>
                      {item.paymentStatus && (
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 6,
                            flexShrink: 0,
                            backgroundColor:
                              item.paymentStatus === 'LUNAS'
                                ? 'hsl(142 76% 93%)'
                                : item.paymentStatus === 'BELUM_LUNAS'
                                ? 'hsl(0 86% 94%)'
                                : 'hsl(210 25% 93%)',
                            color:
                              item.paymentStatus === 'LUNAS'
                                ? 'hsl(142 72% 24%)'
                                : item.paymentStatus === 'BELUM_LUNAS'
                                ? 'hsl(0 72% 36%)'
                                : 'hsl(215 24% 32%)',
                          }}
                        >
                          {item.paymentStatus}
                        </span>
                      )}
                    </div>

                    {/* Nominal: Manager sees full breakdown; Admin Shift sees single total if > 0; Gudang sees none (HPP guard) */}
                    {!isGudang && item.totalAmount !== null && item.totalAmount > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                          {formatRp(item.totalAmount)}
                        </span>
                        {isManager && item.linkedExpenseId && (
                          <span
                            style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 6,
                              backgroundColor: 'hsl(38 92% 92%)',
                              color: 'hsl(28 84% 28%)',
                              border: '1px solid hsl(38 78% 76%)',
                            }}
                          >
                            Masuk Biaya Opex
                          </span>
                        )}
                      </div>
                    )}

                    {/* Description / Keterangan */}
                    <p
                      style={{
                        margin: 0,
                        fontSize: '0.76rem',
                        color: 'var(--color-text-muted)',
                        lineHeight: 1.45,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        flex: 1,
                      }}
                    >
                      {item.description || item.operationalItems || 'Tidak ada catatan tambahan.'}
                    </p>

                    {/* Footer: Uploader + Actions */}
                    <div
                      style={{
                        marginTop: 4,
                        paddingTop: 8,
                        borderTop: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: '0.7rem',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.uploadedByName} · {ROLE_LABELS[item.uploadedByRole] ?? item.uploadedByRole}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setViewingItem(item)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-surface-alt)',
                            color: 'var(--color-text)',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Detail
                        </button>

                        {isManager && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              aria-label={`Edit nota ${item.merchantName}`}
                              title="Edit / Sinkronkan Biaya Operasional"
                              style={{
                                padding: '5px',
                                borderRadius: 6,
                                border: '1px solid var(--color-border)',
                                backgroundColor: '#ffffff',
                                color: 'hsl(221 76% 38%)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                              }}
                            >
                              <Pencil size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingItem(item);
                                setDeleteReason('');
                                setDeleteError('');
                              }}
                              aria-label={`Hapus nota ${item.merchantName}`}
                              title="Hapus arsip nota"
                              style={{
                                padding: '5px',
                                borderRadius: 6,
                                border: '1px solid hsl(0 70% 86%)',
                                backgroundColor: 'hsl(0 86% 97%)',
                                color: 'hsl(0 72% 40%)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                              }}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* ── Pagination ── */}
          {data && data.pagination.totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                padding: '6px 2px',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                Halaman <strong>{data.pagination.page}</strong> dari{' '}
                <strong>{data.pagination.totalPages}</strong> ({data.pagination.totalCount} arsip)
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <ChevronLeft size={14} aria-hidden="true" /> Sebelumnya
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  Berikutnya <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 1: LIGHTBOX / DETAIL ARSIP NOTA (Semua 3 Role)
      ═══════════════════════════════════════════════════════════ */}
      {viewingItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detail nota ${viewingItem.merchantName}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewingItem(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 820,
              maxHeight: '92vh',
              overflow: 'auto',
              borderRadius: 14,
            }}
          >
            <div
              className="card-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                position: 'sticky',
                top: 0,
                backgroundColor: '#ffffff',
                zIndex: 2,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800 }}>
                  {viewingItem.merchantName}
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {formatDateId(viewingItem.receiptDate)} ·{' '}
                  {CATEGORY_META[viewingItem.category]?.label ?? viewingItem.category}
                  {viewingItem.invoiceNumber ? ` · No. ${viewingItem.invoiceNumber}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {viewingItem.imageUrl && (
                  <a
                    href={viewingItem.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm btn-secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    <span>Buka Penuh</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  aria-label="Tutup detail"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                    padding: 6,
                    display: 'inline-flex',
                  }}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {viewingItem.imageUrl && (
                <div
                  style={{
                    backgroundColor: 'hsl(215 28% 12%)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewingItem.imageUrl}
                    alt={`Foto penuh nota ${viewingItem.merchantName}`}
                    style={{ maxWidth: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block' }}
                  />
                </div>
              )}

              {/* Financial breakdown: Manager full, Admin Shift single total, Gudang hidden */}
              {!isGudang && viewingItem.totalAmount !== null && viewingItem.totalAmount > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 8,
                    padding: 12,
                    borderRadius: 10,
                    backgroundColor: 'var(--color-surface-alt)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total Nota</div>
                    <div style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                      {formatRp(viewingItem.totalAmount)}
                    </div>
                  </div>
                  {isManager && (viewingItem.stockAmount ?? 0) > 0 && (
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Porsi Stok</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{formatRp(viewingItem.stockAmount)}</div>
                    </div>
                  )}
                  {isManager && (viewingItem.operationalAmount ?? 0) > 0 && (
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Porsi Operasional</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'hsl(28 84% 34%)' }}>
                        {formatRp(viewingItem.operationalAmount)}
                      </div>
                    </div>
                  )}
                  {isManager && (viewingItem.consignmentAmount ?? 0) > 0 && (
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Porsi Titipan</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'hsl(271 65% 36%)' }}>
                        {formatRp(viewingItem.consignmentAmount)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Keterangan lengkap */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: '#f8fafc',
                  border: '1px solid var(--color-border)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div>
                  <strong>Keterangan / Rincian:</strong>
                  <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', color: 'var(--color-text)' }}>
                    {viewingItem.description || 'Tidak ada catatan tambahan.'}
                  </div>
                </div>
                {viewingItem.operationalItems && (
                  <div>
                    <strong>Item Operasional:</strong> {viewingItem.operationalItems}
                  </div>
                )}
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Diunggah oleh <strong>{viewingItem.uploadedByName}</strong> (
                  {ROLE_LABELS[viewingItem.uploadedByRole] ?? viewingItem.uploadedByRole})
                  {isManager && viewingItem.sourceFolder ? ` · Sumber: ${viewingItem.sourceFolder}` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 2: UNGGAH FOTO NOTA BARU (Semua 3 Role)
      ═══════════════════════════════════════════════════════════ */}
      {showUploadModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-upload-title`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submittingUpload) setShowUploadModal(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 540, maxHeight: '92vh', overflow: 'auto', borderRadius: 14 }}
          >
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3
                id={`${uid}-upload-title`}
                style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Upload size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                Unggah Foto Nota Baru
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                disabled={submittingUpload}
                aria-label="Tutup form unggah"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitUpload} className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* File / Camera Picker */}
              <div>
                <label className="form-label" htmlFor={`${uid}-up-file`}>
                  Foto Struk / Nota / Buku <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <input
                  ref={fileInputRef}
                  id={`${uid}-up-file`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '100%',
                    padding: uploadPreviewUrl ? 8 : '22px 14px',
                    borderRadius: 10,
                    border: '1.5px dashed var(--color-primary)',
                    backgroundColor: 'hsl(142 76% 97%)',
                    color: 'hsl(142 72% 24%)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {uploadPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploadPreviewUrl}
                      alt="Pratinjau foto nota"
                      style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8, objectFit: 'contain' }}
                    />
                  ) : (
                    <>
                      <Camera size={24} aria-hidden="true" />
                      <span style={{ fontSize: '0.84rem', fontWeight: 700 }}>
                        Ambil Foto atau Pilih Gambar dari Galeri
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        JPG / PNG / WebP · Otomatis dikompres WebP ringan
                      </span>
                    </>
                  )}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor={`${uid}-up-date`}>Tanggal Nota</label>
                  <input
                    id={`${uid}-up-date`}
                    type="date"
                    className="form-input"
                    value={upDate}
                    onChange={(e) => setUpDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-up-cat`}>Kategori</label>
                  <select
                    id={`${uid}-up-cat`}
                    className="form-input"
                    value={upCategory}
                    onChange={(e) => setUpCategory(e.target.value as PurchaseReceiptCategory)}
                  >
                    {UPLOAD_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor={`${uid}-up-merchant`}>
                  Nama Toko / Supplier / Mitra <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <input
                  id={`${uid}-up-merchant`}
                  type="text"
                  className="form-input"
                  value={upMerchant}
                  onChange={(e) => setUpMerchant(e.target.value)}
                  placeholder="Contoh: Toko New Prasida, Tbk. Kurnia, Mitra Donat Bu Yuli"
                  required
                  maxLength={180}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor={`${uid}-up-inv`}>No. Nota / Invoice (Opsional)</label>
                  <input
                    id={`${uid}-up-inv`}
                    type="text"
                    className="form-input"
                    value={upInvoice}
                    onChange={(e) => setUpInvoice(e.target.value)}
                    placeholder="Mis. INV-001"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-up-status`}>Status Pembayaran</label>
                  <select
                    id={`${uid}-up-status`}
                    className="form-input"
                    value={upPayStatus}
                    onChange={(e) => setUpPayStatus(e.target.value as typeof upPayStatus)}
                  >
                    <option value="LUNAS">LUNAS</option>
                    <option value="BELUM_LUNAS">BELUM LUNAS</option>
                    <option value="CAMPURAN">CAMPURAN</option>
                    <option value="INFO">INFO / CATATAN</option>
                  </select>
                </div>
              </div>

              {/* Nominal fields for Manager & Admin Shift only (hidden for Gudang to preserve HPP boundary) */}
              {!isGudang && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <div>
                    <label className="form-label" htmlFor={`${uid}-up-total`}>Total Nota (Rp)</label>
                    <input
                      id={`${uid}-up-total`}
                      type="number"
                      min={0}
                      className="form-input"
                      value={upTotal}
                      onChange={(e) => setUpTotal(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {(upCategory === 'OPERASIONAL' || upCategory === 'CAMPURAN') && (
                    <div>
                      <label className="form-label" htmlFor={`${uid}-up-opex`}>Porsi Biaya Operasional (Rp)</label>
                      <input
                        id={`${uid}-up-opex`}
                        type="number"
                        min={0}
                        className="form-input"
                        value={upOpexAmt}
                        onChange={(e) => setUpOpexAmt(e.target.value)}
                        placeholder="Contoh: 15000 (kresek/parkir)"
                      />
                    </div>
                  )}
                </div>
              )}

              {(upCategory === 'OPERASIONAL' || upCategory === 'CAMPURAN') && (
                <div>
                  <label className="form-label" htmlFor={`${uid}-up-opex-items`}>Item Operasional (Kresek/ATK/Parkir)</label>
                  <input
                    id={`${uid}-up-opex-items`}
                    type="text"
                    className="form-input"
                    value={upOpexItems}
                    onChange={(e) => setUpOpexItems(e.target.value)}
                    placeholder="Contoh: Kresek Kaki Tiga 2 pcs, Parkir"
                    maxLength={500}
                  />
                </div>
              )}

              <div>
                <label className="form-label" htmlFor={`${uid}-up-desc`}>Keterangan / Rincian Barang</label>
                <textarea
                  id={`${uid}-up-desc`}
                  className="form-input form-textarea"
                  rows={3}
                  value={upDesc}
                  onChange={(e) => setUpDesc(e.target.value)}
                  placeholder="Tulis ringkasan isi nota, nama shift yang belanja, atau catatan tambahan..."
                  maxLength={2000}
                />
              </div>

              {/* Manager-only direct sync to operating_expenses */}
              {isManager && (upCategory === 'OPERASIONAL' || upCategory === 'CAMPURAN') && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: 'hsl(38 92% 95%)',
                    border: '1px solid hsl(38 78% 78%)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={upSyncOpex}
                      onChange={(e) => setUpSyncOpex(e.target.checked)}
                    />
                    <span>Sekaligus catat ke Biaya Operasional (pengurang Laba Bersih)</span>
                  </label>
                  {upSyncOpex && (
                    <select
                      className="form-input"
                      value={upExpCat}
                      onChange={(e) => setUpExpCat(e.target.value as ExpenseCategory)}
                      aria-label="Kategori biaya operasional"
                    >
                      {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {uploadError && (
                <div className="alert alert-error" role="alert" style={{ margin: 0 }}>
                  {uploadError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={submittingUpload}
                  onClick={() => setShowUploadModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingUpload}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {submittingUpload ? (
                    <>
                      <Loader2 size={15} className="spin-icon" aria-hidden="true" /> Mengunggah...
                    </>
                  ) : (
                    <>
                      <Upload size={15} aria-hidden="true" /> Simpan Nota
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 3: EDIT & SINKRON OPEX (Eksklusif MANAGER)
      ═══════════════════════════════════════════════════════════ */}
      {isManager && editingItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-edit-title`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submittingEdit) setEditingItem(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflow: 'auto', borderRadius: 14 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 id={`${uid}-edit-title`} style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800 }}>
                Edit Arsip Nota (Manager)
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                disabled={submittingEdit}
                aria-label="Tutup edit"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-date`}>Tanggal Nota</label>
                  <input
                    id={`${uid}-ed-date`}
                    type="date"
                    className="form-input"
                    value={edDate}
                    onChange={(e) => setEdDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-cat`}>Kategori</label>
                  <select
                    id={`${uid}-ed-cat`}
                    className="form-input"
                    value={edCategory}
                    onChange={(e) => setEdCategory(e.target.value as PurchaseReceiptCategory)}
                  >
                    {UPLOAD_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor={`${uid}-ed-merchant`}>Nama Toko / Mitra</label>
                <input
                  id={`${uid}-ed-merchant`}
                  type="text"
                  className="form-input"
                  value={edMerchant}
                  onChange={(e) => setEdMerchant(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-inv`}>No. Invoice</label>
                  <input id={`${uid}-ed-inv`} type="text" className="form-input" value={edInvoice} onChange={(e) => setEdInvoice(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-status`}>Status Bayar</label>
                  <select
                    id={`${uid}-ed-status`}
                    className="form-input"
                    value={edPayStatus}
                    onChange={(e) => setEdPayStatus(e.target.value as typeof edPayStatus)}
                  >
                    <option value="LUNAS">LUNAS</option>
                    <option value="BELUM_LUNAS">BELUM LUNAS</option>
                    <option value="CAMPURAN">CAMPURAN</option>
                    <option value="INFO">INFO</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-total`}>Total Nota (Rp)</label>
                  <input id={`${uid}-ed-total`} type="number" min={0} className="form-input" value={edTotal} onChange={(e) => setEdTotal(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-stock`}>Porsi Stok (Rp)</label>
                  <input id={`${uid}-ed-stock`} type="number" min={0} className="form-input" value={edStock} onChange={(e) => setEdStock(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-opex`}>Porsi Operasional (Rp)</label>
                  <input id={`${uid}-ed-opex`} type="number" min={0} className="form-input" value={edOpex} onChange={(e) => setEdOpex(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`${uid}-ed-consign`}>Porsi Titipan (Rp)</label>
                  <input id={`${uid}-ed-consign`} type="number" min={0} className="form-input" value={edConsign} onChange={(e) => setEdConsign(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor={`${uid}-ed-opex-items`}>Item Operasional</label>
                <input id={`${uid}-ed-opex-items`} type="text" className="form-input" value={edOpexItems} onChange={(e) => setEdOpexItems(e.target.value)} />
              </div>

              <div>
                <label className="form-label" htmlFor={`${uid}-ed-desc`}>Keterangan</label>
                <textarea id={`${uid}-ed-desc`} className="form-input form-textarea" rows={3} value={edDesc} onChange={(e) => setEdDesc(e.target.value)} />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 600 }}>
                <input type="checkbox" checked={edVerified} onChange={(e) => setEdVerified(e.target.checked)} />
                <span>Tandai sebagai arsip terverifikasi</span>
              </label>

              {!editingItem.linkedExpenseId ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: 'hsl(38 92% 95%)',
                    border: '1px solid hsl(38 78% 78%)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                    <input type="checkbox" checked={edSyncOpex} onChange={(e) => setEdSyncOpex(e.target.checked)} />
                    <span>Sinkronkan porsi operasional ke tabel Biaya Operasional</span>
                  </label>
                  {edSyncOpex && (
                    <select className="form-input" value={edExpCat} onChange={(e) => setEdExpCat(e.target.value as ExpenseCategory)}>
                      {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    backgroundColor: 'hsl(142 76% 94%)',
                    color: 'hsl(142 72% 24%)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  Sudah terhubung ke Biaya Operasional (tidak akan tercatat ganda).
                </div>
              )}

              {editError && (
                <div className="alert alert-error" role="alert" style={{ margin: 0 }}>
                  {editError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-secondary" disabled={submittingEdit} onClick={() => setEditingItem(null)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingEdit}>
                  {submittingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 4: SOFT-DELETE ARSIP NOTA (Eksklusif MANAGER)
      ═══════════════════════════════════════════════════════════ */}
      {isManager && deletingItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-del-title`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submittingDelete) setDeletingItem(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 420, borderRadius: 14 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 id={`${uid}-del-title`} style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: 'var(--color-error)' }}>
                Hapus Arsip Nota
              </h3>
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={submittingDelete}
                aria-label="Tutup konfirmasi hapus"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleConfirmDelete} className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5 }}>
                Arsip <strong>{deletingItem.merchantName}</strong> ({formatDateId(deletingItem.receiptDate)}) akan disembunyikan via soft-delete dan tercatat di log audit.
              </p>
              <div>
                <label className="form-label" htmlFor={`${uid}-del-reason`}>Alasan Penghapusan</label>
                <input
                  id={`${uid}-del-reason`}
                  type="text"
                  className="form-input"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Contoh: Foto duplikat / salah unggah"
                  maxLength={200}
                />
              </div>
              {deleteError && <div className="alert alert-error" role="alert" style={{ margin: 0 }}>{deleteError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary" disabled={submittingDelete} onClick={() => setDeletingItem(null)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-danger" disabled={submittingDelete}>
                  {submittingDelete ? 'Menghapus...' : 'Konfirmasi Hapus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
