'use client';
// =============================================================
// src/app/admin/gudang-approval/page.tsx
// Portal Approval Penerimaan Barang Masuk (Manager Only) — Wiramart v3.0
// STANDAR: 2-Layer Executive Separation, Zero-Trust ACID Verification, Clean UI
// =============================================================

import { useState, useEffect, useRef } from 'react';
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Send,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  ShieldCheck,
  Building2,
  Flame,
  Zap,
  Barcode,
  Plus,
  Phone,
  MapPin,
  Edit,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';

import { formatRupiah, computeFefoDiscountedPrice } from '@/lib/utils/helpers';
import LaporanMutasiStokSection from '@/features/portal/laporan/LaporanMutasiStokSection';
import { useAdmin } from '@/features/portal/PortalLayoutClient';
import {
  EXCEL_BORDER,
  EXCEL_FILL,
  EXCEL_FMT,
  EXCEL_FONT,
  applySheetLayout,
  calcWrapRowHeight,
  colLetter,
  createWiramartWorkbook,
  downloadWorkbookBlob,
  formatWibDateTime,
  sanitizeExcelText,
  styleBannerBlock,
  toSafeExcelNum,
  todayWibSlug,
} from '@/lib/utils/exportSelectedExcel';

type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';

type AutoChecklistInfo = {
  passed: boolean;
  warnings: string[];
  graceUntil: string | null;
  remainingSeconds: number;
};

type SubmissionItem = {
  id: string;
  receiveNumber: string;
  supplierName: string | null;
  deliveryNote: string | null;
  status: DraftStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  managerNote: string | null;
  createdAt: string;
  creatorName: string;
  creatorNim: string;
  hasNewProductProposal?: boolean;
  autoChecklist?: AutoChecklistInfo | null;
};

type ItemDetail = {
  id: string;
  productId: string;
  productName: string;
  productIsActive?: boolean;
  productSellingPrice?: number | string;
  productBarcode?: string | null;
  productUnit?: string;
  productCategoryName?: string | null;
  batchCode: string;
  qty: number;
  costPrice: number | string;
  expiryDate: string | null;
  conditionNote: string | null;
};

type FullSubmission = SubmissionItem & {
  items: ItemDetail[];
};

// ── Tipe Data FEFO Alert & Diskon (Wiramart v3.0) ───────────────
export type AlertLevel = 'H1' | 'H3' | 'H5' | 'H7';
export type ReportStatus = 'ALERT_ONLY' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
export type ManagerDecision = 'DISCOUNT' | 'DISPLAY_FRONT' | 'DESTROY' | 'RETURN_SUPPLIER' | 'HOLD';

export type ConditionReportItem = {
  id: string;
  batchId: string;
  productId: string;
  productName: string;
  productUnit: string;
  sellingPrice: string | number;
  batchCode: string;
  currentBatchQty: number;
  alertLevel: AlertLevel;
  qtyAtAlert: number;
  expiryDate: string;
  daysRemainingAtAlert: number;
  status: ReportStatus;
  physicalCondition: string | null;
  gudangSuggestion: string | null;
  suggestedDiscountPct: string | number | null;
  submittedAt: string | null;
  managerDecision: ManagerDecision | null;
  approvedDiscountPct: string | number | null;
  managerNote: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  executionNote: string | null;
  createdAt: string;
  isExpired?: boolean;
  discountBarcode?: string | null;
  discountedPrice?: number | null;
};

function getTodayWibIsoManager(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function formatDecisionLabel(decision: ManagerDecision | null | undefined): string {
  switch (decision) {
    case 'DISCOUNT':
      return 'Diskon Obral';
    case 'DISPLAY_FRONT':
      return 'Pajang Rak Depan';
    case 'DESTROY':
      return 'Musnahkan';
    case 'RETURN_SUPPLIER':
      return 'Retur ke Supplier';
    case 'HOLD':
      return 'Tahan Sementara';
    default:
      return decision || '—';
  }
}

type ModTodayStatus = {
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  managerName: string | null;
};

type SupplierItem = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  creatorName?: string | null;
};

async function requestModStatus(signal?: AbortSignal): Promise<ModTodayStatus | null> {
  const res = await fetch('/api/admin/duty', { signal });
  const json = await res.json();
  return res.ok && json.success && json.data?.today ? (json.data.today as ModTodayStatus) : null;
}

async function requestSuppliers(query: string, signal?: AbortSignal): Promise<SupplierItem[] | null> {
  const params = new URLSearchParams({
    ...(query.trim() && { search: query.trim() }),
  });
  const res = await fetch(`/api/admin/suppliers?${params}`, { signal });
  const json = await res.json();
  return res.ok && json.success ? ((json.data || []) as SupplierItem[]) : null;
}

async function requestSubmissions(filter: string, signal?: AbortSignal): Promise<SubmissionItem[]> {
  const statusParam = filter === 'semua' ? '' : `?status=${filter.toUpperCase()}`;
  const res = await fetch(`/api/gudang/penerimaan${statusParam}`, {
    signal,
    headers: { 'x-portal-scope': 'admin' },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? 'Gagal memuat antrian persetujuan');
  }
  return (json.data.items || []) as SubmissionItem[];
}

async function requestFefoReports(status: string, searchQuery: string, signal?: AbortSignal): Promise<ConditionReportItem[] | null> {
  const params = new URLSearchParams({
    page: '1',
    limit: '100',
    ...(status !== 'semua' && { status }),
    ...(searchQuery.trim() && { search: searchQuery.trim() }),
  });
  const res = await fetch(`/api/gudang/fefo-alerts?${params}`, {
    signal,
    headers: { 'x-portal-scope': 'admin' },
  });
  const json = await res.json();
  return json.success && json.data ? ((json.data.items || []) as ConditionReportItem[]) : null;
}

export default function GudangApprovalPage() {
  const { isManager } = useAdmin();
  // Top Level Section Switch
  const [mainSection, setMainSection] = useState<'PENERIMAAN' | 'FEFO' | 'SUPPLIERS' | 'MUTASI'>('PENERIMAAN');

  // ── State MOD (Manager on Duty) ──────────────────────────────
  const [modStatus, setModStatus] = useState<ModTodayStatus | null>(null);

  // ── State Database Supplier (Fase 5.2 & 5.4) ─────────────────
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierItem | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    address: '',
    notes: '',
    isActive: true,
  });
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<{ id: string; name: string } | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState(false);

  // State Penerimaan Barang (Fase 1)
  const [activeTab, setActiveTab] = useState<'submitted' | 'semua' | 'approved' | 'revised' | 'rejected'>('submitted');
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State Expand Item
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<FullSubmission | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // State Modal Aksi Manager (Penerimaan)
  const [actionType, setActionType] = useState<'APPROVE' | 'REVISI' | 'TOLAK' | null>(null);
  const [selectedSub, setSelectedSub] = useState<SubmissionItem | null>(null);
  const [approvePreviewItems, setApprovePreviewItems] = useState<ItemDetail[]>([]);
  const [approvePriceEdits, setApprovePriceEdits] = useState<Record<string, { sellingPrice: string; costPrice: string }>>({});
  const [actionNote, setActionNote] = useState('');
  const [processingAction, setProcessingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // ── State FEFO & Diskon Darurat (Fase 2 & 3) ───────────────────
  const [fefoReports, setFefoReports] = useState<ConditionReportItem[]>([]);
  const [loadingFefo, setLoadingFefo] = useState(false);
  const [fefoStatusFilter, setFefoStatusFilter] = useState<'SUBMITTED' | 'APPROVED' | 'semua'>('SUBMITTED');
  const [fefoSearch, setFefoSearch] = useState('');

  // Modal Keputusan Manager FEFO
  const [selectedFefo, setSelectedFefo] = useState<ConditionReportItem | null>(null);
  const [fefoDecision, setFefoDecision] = useState<ManagerDecision>('DISCOUNT');
  const [approvedDiscountPct, setApprovedDiscountPct] = useState<number>(30);
  const [managerFefoNote, setManagerFefoNote] = useState('');
  const [submittingFefoDecision, setSubmittingFefoDecision] = useState(false);
  const [fefoDecisionError, setFefoDecisionError] = useState<string | null>(null);
  const [createdBarcodeToast, setCreatedBarcodeToast] = useState<string | null>(null);
  const [exportingFefoExcel, setExportingFefoExcel] = useState(false);

  // ── Ekspor Rekap Laporan FEFO ke Excel (.xlsx) Standar Akademik Wiramart ──
  async function handleExportFefoExcel() {
    if (!fefoReports || fefoReports.length === 0) {
      alert('Tidak ada data laporan FEFO untuk diekspor pada filter ini.');
      return;
    }
    setExportingFefoExcel(true);
    try {
      const wb = await createWiramartWorkbook('Manager Gudang - Audit FEFO');

      const filterLabel =
        fefoStatusFilter === 'SUBMITTED'
          ? 'Menunggu Keputusan'
          : fefoStatusFilter === 'APPROVED'
            ? 'Telah Disetujui / Diskon Aktif'
            : 'Semua Laporan FEFO';

      const ws = wb.addWorksheet('Rekap Laporan FEFO');
      const fefoCols = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nama Produk', width: 32, align: 'left' as const },
        { header: 'Kode Batch', width: 16, align: 'center' as const },
        { header: 'Tingkat Peringatan', width: 20, align: 'center' as const },
        { header: 'Tanggal Kedaluwarsa', width: 18, align: 'center' as const },
        { header: 'Sisa Stok Rak', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Harga Normal (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Catatan Fisik Gudang', width: 28, align: 'left' as const },
        { header: 'Usulan Gudang', width: 24, align: 'left' as const },
        { header: 'Status Laporan', width: 20, align: 'center' as const },
        { header: 'Keputusan Manager', width: 20, align: 'center' as const },
        { header: 'Diskon (%)', width: 12, align: 'right' as const, fmt: EXCEL_FMT.PCT },
        { header: 'Harga Diskon (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Barcode Diskon / Keterangan', width: 28, align: 'left' as const },
      ];

      fefoCols.forEach((col, i) => {
        ws.getColumn(i + 1).width = col.width;
      });

      styleBannerBlock(ws, {
        title: 'REKAPITULASI AUDIT FEFO, KEDALUWARSA & DISKON DARURAT — WIRAMART UNPERBA',
        subtitle: `Filter Status: ${filterLabel} • ${fefoReports.length} Laporan FEFO • Dicetak: ${formatWibDateTime()} WIB`,
        endCol: fefoCols.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws.getRow(3).height = 8;

      const hRow = ws.getRow(4);
      hRow.height = 28;
      fefoCols.forEach((col, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = col.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: true };
      });

      const dataStart = 5;
      let totalQtyAll = 0;

      fefoReports.forEach((rep, idx) => {
        const rowNum = dataStart + idx;
        const alertDesc =
          rep.alertLevel === 'H1'
            ? 'H-1 Kritis (Besok ED)'
            : rep.alertLevel === 'H3'
              ? 'H-3 Mendesak'
              : rep.alertLevel === 'H5'
                ? 'H-5 Peringatan'
                : 'H-7 Pantauan';

        const statusDesc =
          rep.status === 'SUBMITTED'
            ? 'Menunggu Keputusan'
            : rep.status === 'APPROVED'
              ? 'Disetujui'
              : rep.status === 'REJECTED'
                ? 'Ditolak'
                : rep.status === 'EXECUTED'
                  ? 'Selesai / Terlaksana'
                  : 'Menunggu Pemeriksaan';

        const decisionDesc =
          rep.managerDecision === 'DISCOUNT'
            ? 'Diskon Obral'
            : rep.managerDecision === 'DISPLAY_FRONT'
              ? 'Pajang Bagian Depan'
              : rep.managerDecision === 'DESTROY'
                ? 'Dimusnahkan (Kedaluwarsa)'
                : rep.managerDecision === 'RETURN_SUPPLIER'
                  ? 'Retur Pemasok'
                  : rep.managerDecision === 'HOLD'
                    ? 'Ditahan Sementara'
                    : '—';

        const productNameTxt = sanitizeExcelText(rep.productName) || '—';
        const batchTxt = sanitizeExcelText(rep.batchCode) || '—';
        const condTxt = sanitizeExcelText(rep.physicalCondition) || '—';
        const suggTxt = sanitizeExcelText(rep.gudangSuggestion) || '—';
        const barcodeOrNote = rep.discountBarcode
          ? sanitizeExcelText(`Barcode: ${rep.discountBarcode}`)
          : sanitizeExcelText(rep.managerNote) || '—';

        const qtyVal = Math.round(toSafeExcelNum(rep.currentBatchQty));
        totalQtyAll += qtyVal;

        const sellPriceVal = Math.round(toSafeExcelNum(rep.sellingPrice));
        const rawPct = rep.approvedDiscountPct ? toSafeExcelNum(rep.approvedDiscountPct) : null;
        const discPriceRaw =
          rep.discountedPrice ??
          (rawPct ? computeFefoDiscountedPrice(sellPriceVal, rawPct) : 0);
        const discPriceVal = discPriceRaw > 0 ? Math.round(discPriceRaw) : null;

        const rowValues: (string | number)[] = [
          idx + 1,
          productNameTxt,
          batchTxt,
          alertDesc,
          rep.expiryDate ? sanitizeExcelText(rep.expiryDate.slice(0, 10)) : '—',
          qtyVal,
          sellPriceVal,
          condTxt,
          suggTxt,
          statusDesc,
          decisionDesc,
          rawPct !== null && rawPct > 0 ? rawPct : '—',
          discPriceVal !== null ? discPriceVal : '—',
          barcodeOrNote,
        ];

        const row = ws.getRow(rowNum);
        const isZebra = idx % 2 === 1;

        rowValues.forEach((val, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          const meta = fefoCols[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: typeof val === 'string' && meta.fmt ? 'center' : meta.align,
            wrapText: cIdx === 1 || cIdx === 7 || cIdx === 8 || cIdx === 13,
          };
          if (typeof val === 'number' && meta.fmt) {
            cell.numFmt = meta.fmt;
          }
          if (cIdx === 3 && rep.alertLevel === 'H1') {
            cell.fill = EXCEL_FILL.DANGER_SOFT;
            cell.font = { ...EXCEL_FONT.BOLD, color: { argb: 'FF991B1B' } };
          } else if (cIdx === 3 && rep.alertLevel === 'H3') {
            cell.fill = EXCEL_FILL.WARN_SOFT;
            cell.font = { ...EXCEL_FONT.BOLD, color: { argb: 'FF92400E' } };
          } else if (isZebra) {
            cell.fill = EXCEL_FILL.ZEBRA;
          }
        });

        row.height = calcWrapRowHeight(
          [
            { text: productNameTxt, width: fefoCols[1].width },
            { text: condTxt, width: fefoCols[7].width },
            { text: suggTxt, width: fefoCols[8].width },
            { text: barcodeOrNote, width: fefoCols[13].width },
          ],
          21,
          14,
        );
      });

      const dataEnd = dataStart + fefoReports.length - 1;
      const totalRow = ws.getRow(dataEnd + 1);
      totalRow.height = 24;
      const qtyColChar = colLetter(6); // F: Sisa Stok Rak

      fefoCols.forEach((col, cIdx) => {
        const cell = totalRow.getCell(cIdx + 1);
        if (cIdx === 1) {
          cell.value = `TOTAL BATCH KEDALUWARSA (${fefoReports.length} Laporan)`;
        } else if (cIdx === 5) {
          cell.value = {
            formula: `SUM(${qtyColChar}${dataStart}:${qtyColChar}${dataEnd})`,
            result: totalQtyAll,
          };
          cell.numFmt = EXCEL_FMT.INT;
        } else {
          cell.value = '';
        }
        cell.font = EXCEL_FONT.BOLD;
        cell.fill = EXCEL_FILL.TOTAL;
        cell.border = EXCEL_BORDER.TOTAL;
        cell.alignment = { vertical: 'middle', horizontal: col.align };
      });

      applySheetLayout(ws, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: fefoCols.length } },
        orientation: 'landscape',
      });

      await downloadWorkbookBlob(wb, `Rekap_Laporan_FEFO_Wiramart_${todayWibSlug()}.xlsx`);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor laporan FEFO ke Excel.');
    } finally {
      setExportingFefoExcel(false);
    }
  }

  // ── Ambil Daftar Supplier ────────────────────────────────────
  async function fetchSuppliers(query = supplierSearch) {
    setLoadingSuppliers(true);
    try {
      const items = await requestSuppliers(query);
      if (items) setSuppliers(items);
    } catch {
      // silent
    } finally {
      setLoadingSuppliers(false);
    }
  }

  // ── Simpan / Update Supplier ─────────────────────────────────
  async function handleSaveSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierForm.name.trim()) {
      setSupplierError('Nama pemasok wajib diisi.');
      return;
    }
    setSubmittingSupplier(true);
    setSupplierError(null);
    try {
      const isEdit = Boolean(editingSupplier);
      const url = isEdit ? `/api/admin/suppliers/${editingSupplier!.id}` : '/api/admin/suppliers';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplierForm),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menyimpan pemasok.');
      }

      setSuccessToast(`Pemasok "${supplierForm.name}" berhasil ${isEdit ? 'diperbarui' : 'ditambahkan'}!`);
      setIsSupplierModalOpen(false);
      setEditingSupplier(null);
      setSupplierForm({ name: '', contactPerson: '', phone: '', address: '', notes: '', isActive: true });
      fetchSuppliers();
    } catch (err) {
      setSupplierError(err instanceof Error ? err.message : 'Terjadi kegagalan menyimpan pemasok.');
    } finally {
      setSubmittingSupplier(false);
    }
  }

  // ── Hapus / Soft Delete Supplier ─────────────────────────────
  async function handleConfirmDeleteSupplier() {
    if (!confirmDeleteSupplier) return;
    const { id, name } = confirmDeleteSupplier;
    setDeletingSupplier(true);
    try {
      const res = await fetch(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessToast(`Pemasok "${name}" berhasil dihapus.`);
        setConfirmDeleteSupplier(null);
        fetchSuppliers();
      } else {
        setErrorMsg(json.error ?? 'Gagal menghapus pemasok.');
        setConfirmDeleteSupplier(null);
      }
    } catch {
      setErrorMsg('Gagal terhubung ke server.');
      setConfirmDeleteSupplier(null);
    } finally {
      setDeletingSupplier(false);
    }
  }


  const supplierSearchRef = useRef(supplierSearch);
  const fefoSearchRef = useRef(fefoSearch);
  useEffect(() => {
    supplierSearchRef.current = supplierSearch;
    fefoSearchRef.current = fefoSearch;
  }, [supplierSearch, fefoSearch]);

  // ── Ambil Daftar Pengajuan Penerimaan ─────────────────────────
  async function fetchSubmissions(filter = activeTab) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await requestSubmissions(filter);
      setSubmissions(items);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kegagalan memuat data.');
    } finally {
      setLoading(false);
    }
  }

  // ── Ambil Antrian Laporan FEFO ────────────────────────────────
  async function fetchFefoReports(status = fefoStatusFilter) {
    setLoadingFefo(true);
    try {
      const items = await requestFefoReports(status, fefoSearch);
      if (items) setFefoReports(items);
    } catch {
      // silent
    } finally {
      setLoadingFefo(false);
    }
  }

  useEffect(() => {
    if (!isManager) return;
    const controller = new AbortController();
    requestModStatus(controller.signal)
      .then((today) => {
        if (!controller.signal.aborted && today) {
          setModStatus(today);
        }
      })
      .catch(() => { /* silent */ });
    return () => controller.abort();
  }, [isManager]);

  useEffect(() => {
    const controller = new AbortController();

    if (mainSection === 'PENERIMAAN') {
      requestSubmissions(activeTab, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          setErrorMsg(null);
          setSubmissions(items);
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            setErrorMsg(err instanceof Error ? err.message : 'Terjadi kegagalan memuat data.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else if (mainSection === 'FEFO') {
      requestFefoReports(fefoStatusFilter, fefoSearchRef.current, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted && items) setFefoReports(items);
        })
        .catch(() => { /* silent */ })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingFefo(false);
        });
    } else if (mainSection === 'SUPPLIERS') {
      requestSuppliers(supplierSearchRef.current, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted && items) setSuppliers(items);
        })
        .catch(() => { /* silent */ })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingSuppliers(false);
        });
    }

    return () => controller.abort();
  }, [activeTab, fefoStatusFilter, mainSection]);


  // Handle Eksekusi Keputusan Manager FEFO
  async function handleExecuteFefoDecision() {
    if (!selectedFefo) return;
    setSubmittingFefoDecision(true);
    setFefoDecisionError(null);

    try {
      const body = {
        decision: fefoDecision,
        approvedDiscountPct: fefoDecision === 'DISCOUNT' ? approvedDiscountPct : undefined,
        managerNote: managerFefoNote.trim() || undefined,
      };

      const res = await fetch(`/api/admin/gudang/fefo-alerts/${selectedFefo.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal memproses keputusan.');
      }

      if (json.data?.discountBarcode) {
        setCreatedBarcodeToast(
          `Diskon ${approvedDiscountPct}% disetujui. Barcode diskon diterbitkan: ${json.data.discountBarcode}`,
        );
      } else {
        setSuccessToast(`Keputusan ${formatDecisionLabel(fefoDecision)} berhasil ditetapkan untuk produk ${selectedFefo.productName}.`);
      }

      setSelectedFefo(null);
      setManagerFefoNote('');
      fetchFefoReports(fefoStatusFilter);

      setTimeout(() => {
        setSuccessToast(null);
        setCreatedBarcodeToast(null);
      }, 7000);
    } catch (err) {
      setFefoDecisionError(err instanceof Error ? err.message : 'Terjadi kegagalan memproses keputusan.');
    } finally {
      setSubmittingFefoDecision(false);
    }
  }

  // ── Expand Detail Rincian Item ───────────────────────────────
  async function toggleExpand(subId: string) {
    if (expandedId === subId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }

    setExpandedId(subId);
    setLoadingDetail(true);
    setExpandedDetail(null);
    try {
      const res = await fetch(`/api/gudang/penerimaan/${subId}`, {
        headers: { 'x-portal-scope': 'admin' },
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setExpandedDetail(json.data);
      } else {
        alert(json.error ?? 'Gagal memuat rincian item.');
        setExpandedId(null);
      }
    } catch {
      alert('Gagal mengambil rincian dari server.');
      setExpandedId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  // ── Buka Modal Aksi ──────────────────────────────────────────
  async function openActionModal(sub: SubmissionItem, type: 'APPROVE' | 'REVISI' | 'TOLAK') {
    setSelectedSub(sub);
    setActionType(type);
    setActionNote('');
    setActionError(null);
    setApprovePreviewItems([]);
    setApprovePriceEdits({});

    if (type === 'APPROVE') {
      try {
        const res = await fetch(`/api/gudang/penerimaan/${sub.id}`, {
          headers: { 'x-portal-scope': 'admin' },
        });
        const json = await res.json();
        if (res.ok && json.success && json.data?.items) {
          const detailItems = json.data.items as ItemDetail[];
          setApprovePreviewItems(detailItems);
          const initEdits: Record<string, { sellingPrice: string; costPrice: string }> = {};
          for (const it of detailItems) {
            if (it.productIsActive === false) {
              initEdits[it.productId] = {
                sellingPrice: String(Math.round(Number(it.productSellingPrice ?? 0))),
                costPrice: String(Math.round(Number(it.costPrice ?? 0))),
              };
            }
          }
          setApprovePriceEdits(initEdits);
        }
      } catch {
        // non-blocking preview fetch
      }
    }
  }

  // ── Eksekusi Aksi Manager ─────────────────────────────────────
  async function handleExecuteAction() {
    if (!selectedSub || !actionType) return;
    setActionError(null);

    if ((actionType === 'REVISI' || actionType === 'TOLAK') && actionNote.trim().length < 5) {
      setActionError('Catatan / alasan wajib diisi minimal 5 karakter.');
      return;
    }

    setProcessingAction(true);
    try {
      let endpoint = '';
      let body: Record<string, unknown> | undefined = undefined;

      if (actionType === 'APPROVE') {
        endpoint = `/api/admin/gudang/penerimaan/${selectedSub.id}/approve`;
        const overrides = Object.entries(approvePriceEdits)
          .map(([productId, vals]) => ({
            productId,
            sellingPrice: Number(vals.sellingPrice),
            costPrice: Number(vals.costPrice),
          }))
          .filter((o) => Number.isFinite(o.sellingPrice) && o.sellingPrice > 0 && Number.isFinite(o.costPrice) && o.costPrice >= 0);
        if (overrides.length > 0) {
          body = { priceOverrides: overrides };
        }
      } else if (actionType === 'REVISI') {
        endpoint = `/api/admin/gudang/penerimaan/${selectedSub.id}/revisi`;
        body = { catatan: actionNote.trim() };
      } else if (actionType === 'TOLAK') {
        endpoint = `/api/admin/gudang/penerimaan/${selectedSub.id}/tolak`;
        body = { alasan: actionNote.trim() };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal memproses aksi persetujuan.');
      }

      setSuccessToast(
        actionType === 'APPROVE'
          ? `Penerimaan #${selectedSub.receiveNumber} disetujui. Produk & stok telah aktif di kasir.`
          : actionType === 'REVISI'
            ? `Draft #${selectedSub.receiveNumber} dikembalikan ke petugas gudang untuk direvisi.`
            : `Penerimaan #${selectedSub.receiveNumber} ditolak. Stok dibatalkan.`,
      );

      setActionType(null);
      setSelectedSub(null);
      setApprovePreviewItems([]);
      setApprovePriceEdits({});
      fetchSubmissions(activeTab);

      setTimeout(() => {
        setSuccessToast(null);
      }, 5000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Terjadi kegagalan.');
    } finally {
      setProcessingAction(false);
    }
  }

  // Helper Badge Status
  function renderBadge(status: DraftStatus) {
    switch (status) {
      case 'DRAFT':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, background: '#fef3c7', color: '#d97706' }}>
            <Clock size={12} style={{ display: 'inline', marginRight: 4 }} /> DRAFT
          </span>
        );
      case 'SUBMITTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, background: '#e0f2fe', color: '#0284c7' }}>
            <Send size={12} style={{ display: 'inline', marginRight: 4 }} /> MENUNGGU PERSETUJUAN
          </span>
        );
      case 'APPROVED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, background: '#dcfce7', color: '#15803d' }}>
            <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} /> TELAH DISETUJUI (MASUK KASIR)
          </span>
        );
      case 'REVISED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, background: '#ffedd5', color: '#ea580c' }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} /> PERLU REVISI
          </span>
        );
      case 'REJECTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, background: '#fee2e2', color: '#b91c1c' }}>
            <XCircle size={12} style={{ display: 'inline', marginRight: 4 }} /> DITOLAK
          </span>
        );
    }
  }

  function renderAlertBadge(level: AlertLevel) {
    switch (level) {
      case 'H1':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#fee2e2', color: '#b91c1c' }}>
            H-1 Kritis (Besok ED)
          </span>
        );
      case 'H3':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#ffedd5', color: '#c2410c' }}>
            H-3 Mendesak
          </span>
        );
      case 'H5':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#fef3c7', color: '#b45309' }}>
            H-5 Peringatan
          </span>
        );
      case 'H7':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#f1f5f9', color: '#475569' }}>
            H-7 Pantauan
          </span>
        );
    }
  }

  function renderFefoStatusBadge(status: ReportStatus) {
    switch (status) {
      case 'ALERT_ONLY':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, background: '#f1f5f9', color: '#64748b' }}>
            Menunggu Cek Fisik
          </span>
        );
      case 'SUBMITTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#ffedd5', color: '#ea580c' }}>
            Menunggu Keputusan Manager
          </span>
        );
      case 'APPROVED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#dcfce7', color: '#15803d' }}>
            Disetujui Manager
          </span>
        );
      case 'REJECTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, background: '#fee2e2', color: '#b91c1c' }}>
            Ditolak Manager
          </span>
        );
      case 'EXECUTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#e0f2fe', color: '#0284c7' }}>
            Selesai Dieksekusi Lapangan
          </span>
        );
    }
  }

  const pendingCount = submissions.filter((s) => s.status === 'SUBMITTED').length;
  const pendingFefoCount = fefoReports.filter((r) => r.status === 'SUBMITTED').length;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── HEADER HALAMAN ── */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          padding: '20px 22px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: '#dcfce7',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
              Persetujuan Gudang
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              Tinjau barang masuk, keputusan stok mendekati kedaluwarsa, data pemasok, dan mutasi stok.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (mainSection === 'PENERIMAAN') fetchSubmissions(activeTab);
            else if (mainSection === 'FEFO') fetchFefoReports(fefoStatusFilter);
            else if (mainSection === 'SUPPLIERS') fetchSuppliers();
          }}
          style={{
            minHeight: 40,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#475569',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <RefreshCw size={14} className={loading || loadingFefo || loadingSuppliers ? 'spin-icon' : ''} /> Segarkan Data
        </button>
      </div>

      {/* ── INFO PERSETUJUAN OTOMATIS 5 MENIT ── */}
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 10,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: '0.79rem',
          color: '#166534',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={17} color="#16a34a" style={{ flexShrink: 0 }} />
          <span>
            <strong>Persetujuan Otomatis 5 Menit Aktif:</strong> Pengajuan barang masuk dengan data margin &amp; tanggal kedaluwarsa lengkap otomatis masuk stok setelah 5 menit. Item yang perlu perhatian tetap ditahan untuk cek manual.
          </span>
        </div>
        {modStatus?.isCheckedIn && (
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            Sesi Aktif: {modStatus.managerName}
          </span>
        )}
      </div>

      {/* ── TAB UTAMA PERSETUJUAN GUDANG ── */}
      <div className="rep-tabs" role="tablist" aria-label="Kategori Persetujuan Gudang">
        <button
          type="button"
          role="tab"
          aria-selected={mainSection === 'PENERIMAAN'}
          className={`rep-tab${mainSection === 'PENERIMAAN' ? ' active' : ''}`}
          onClick={() => setMainSection('PENERIMAAN')}
        >
          <Truck size={16} />
          <span>Barang Masuk</span>
          {pendingCount > 0 && (
            <span
              style={{
                background: '#dc2626',
                color: '#ffffff',
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mainSection === 'FEFO'}
          className={`rep-tab${mainSection === 'FEFO' ? ' active' : ''}`}
          onClick={() => {
            setMainSection('FEFO');
            fetchFefoReports();
          }}
        >
          <Flame size={16} />
          <span>Kondisi &amp; Diskon</span>
          {pendingFefoCount > 0 && (
            <span
              style={{
                background: '#ea580c',
                color: '#ffffff',
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {pendingFefoCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mainSection === 'SUPPLIERS'}
          className={`rep-tab${mainSection === 'SUPPLIERS' ? ' active' : ''}`}
          onClick={() => {
            setMainSection('SUPPLIERS');
            fetchSuppliers();
          }}
        >
          <Building2 size={16} />
          <span>Pemasok</span>
          {suppliers.length > 0 && (
            <span
              style={{
                background: '#dcfce7',
                color: '#15803d',
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {suppliers.length}
            </span>
          )}
        </button>

        {isManager && (
          <button
            type="button"
            role="tab"
            aria-selected={mainSection === 'MUTASI'}
            className={`rep-tab${mainSection === 'MUTASI' ? ' active' : ''}`}
            onClick={() => setMainSection('MUTASI')}
          >
            <FileSpreadsheet size={16} />
            <span>Mutasi Stok</span>
          </button>
        )}
      </div>


      {/* ── TOAST NOTIFIKASI SUKSES / BARCODE OVERRIDE ── */}
      {createdBarcodeToast && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 10,
            background: '#ffedd5',
            border: '1.5px solid #f97316',
            color: '#9a3412',
            fontSize: '0.88rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 10px rgba(249,115,22,0.15)',
          }}
        >
          <Barcode size={22} color="#ea580c" />
          <span>{createdBarcodeToast}</span>
        </div>
      )}

      {successToast && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 10,
            background: '#dcfce7',
            border: '1px solid #86efac',
            color: '#15803d',
            fontSize: '0.85rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
          }}
        >
          <CheckCircle2 size={18} />
          <span>{successToast}</span>
        </div>
      )}

      {/* ── KONTEN UTAMA: BERDASARKAN EXECUTIVE TAB SWITCHER ── */}
      {mainSection === 'PENERIMAAN' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── FILTER TABS ── */}
          <div className="rep-chip-bar">
        {[
          { id: 'submitted', label: 'Menunggu', badge: pendingCount > 0 ? pendingCount : null },
          { id: 'semua', label: 'Semua' },
          { id: 'approved', label: 'Disetujui' },
          { id: 'revised', label: 'Perlu Revisi' },
          { id: 'rejected', label: 'Ditolak' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`rep-chip${isActive ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
            >
              <span>{tab.label}</span>
              {tab.badge !== null && tab.badge !== undefined && (
                <span
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    borderRadius: 999,
                    padding: '1px 6px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    marginLeft: 4,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── DAFTAR ANTRIAN PENERIMAAN ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
          <RefreshCw size={28} className="spin-icon" style={{ margin: '0 auto 12px' }} />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Memeriksa antrian penerimaan barang...</p>
        </div>
      ) : errorMsg ? (
        <div style={{ padding: 18, borderRadius: 12, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={22} />
          <span>{errorMsg}</span>
        </div>
      ) : submissions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
          <Truck size={48} color="#cbd5e1" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: '#1e293b' }}>
            {activeTab === 'submitted' ? 'Tidak Ada Antrian Menunggu' : 'Tidak Ada Data Penerimaan'}
          </h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
            {activeTab === 'submitted'
              ? 'Semua kiriman barang yang diajukan petugas gudang sudah ditindaklanjuti.'
              : `Belum ada riwayat pada status "${activeTab}".`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {submissions.map((sub) => {
            const isExpanded = expandedId === sub.id;

            return (
              <div
                key={sub.id}
                style={{
                  background: '#ffffff',
                  borderRadius: 14,
                  border:
                    sub.status === 'SUBMITTED'
                      ? '1.5px solid #86efac'
                      : sub.status === 'APPROVED'
                        ? '1px solid #bbf7d0'
                        : sub.status === 'REVISED'
                          ? '1px solid #fed7aa'
                          : '1px solid #e2e8f0',
                  boxShadow: sub.status === 'SUBMITTED' ? '0 4px 12px rgba(22, 163, 74, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                  overflow: 'hidden',
                }}
              >
                {/* Header Kartu Pengajuan */}
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.9rem', color: '#0f172a', background: '#f1f5f9', padding: '3px 10px', borderRadius: 6 }}>
                        {sub.receiveNumber}
                      </span>
                      {renderBadge(sub.status)}
                    </div>

                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Diajukan:{' '}
                      {sub.submittedAt
                        ? new Date(sub.submittedAt).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : new Date(sub.createdAt).toLocaleDateString('id-ID')}
                    </span>
                  </div>

                  {/* Ringkasan Pengirim & Dokumen */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 10,
                      background: '#f8fafc',
                      padding: '10px 14px',
                      borderRadius: 10,
                      fontSize: '0.82rem',
                    }}
                  >
                    <div>
                      <span style={{ color: '#64748b' }}>Penginput (Gudang): </span>
                      <strong style={{ color: '#0f172a' }}>{sub.creatorName} ({sub.creatorNim})</strong>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Supplier: </span>
                      <strong style={{ color: '#0f172a' }}>{sub.supplierName || '— (Umum)'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>No. Surat Jalan / Jenis: </span>
                      <strong style={{ color: '#0f172a' }}>{sub.deliveryNote || '—'}</strong>
                      {(sub.hasNewProductProposal || sub.deliveryNote?.startsWith('[USULAN PRODUK BARU]')) && (
                        <span
                          style={{
                            marginLeft: 6,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: '#ede9fe',
                            color: '#6d28d9',
                            border: '1px solid #c4b5fd',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            display: 'inline-block',
                          }}
                        >
                          USULAN PRODUK BARU
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Auto-Checklist Jeda 5 Menit */}
                  {sub.status === 'SUBMITTED' && sub.autoChecklist && (
                    <div
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: sub.autoChecklist.passed ? '#f0fdf4' : '#fffbeb',
                        border: sub.autoChecklist.passed ? '1px solid #bbf7d0' : '1px solid #fcd34d',
                        color: sub.autoChecklist.passed ? '#15803d' : '#b45309',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      {sub.autoChecklist.passed ? (
                        <span>
                          Lolos pemeriksaan otomatis · Stok otomatis masuk setelah jeda 5 menit
                          {sub.autoChecklist.graceUntil
                            ? ` (pukul ${new Date(sub.autoChecklist.graceUntil).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })} WIB)`
                            : ''}.
                        </span>
                      ) : (
                        <span>
                          Perlu Cek Manual: {sub.autoChecklist.warnings.join(' | ')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Banner Catatan Manager jika ada */}
                  {sub.managerNote && (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: sub.status === 'REVISED' ? '#fff7ed' : '#fef2f2',
                        border: sub.status === 'REVISED' ? '1px solid #fed7aa' : '1px solid #fecaca',
                        fontSize: '0.82rem',
                        color: sub.status === 'REVISED' ? '#c2410c' : '#b91c1c',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <strong>Catatan Sebelumnya: </strong>
                        <span>{sub.managerNote}</span>
                      </div>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(sub.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#15803d',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 0',
                        minHeight: 36,
                      }}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {isExpanded ? 'Tutup Rincian Item' : 'Lihat Rincian Item'}
                    </button>

                    {/* Tombol Persetujuan (Hanya aktif saat status SUBMITTED) */}
                    {sub.status === 'SUBMITTED' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openActionModal(sub, 'REVISI')}
                          style={{
                            minHeight: 38,
                            padding: '7px 14px',
                            borderRadius: 8,
                            border: '1px solid #fed7aa',
                            background: '#fff7ed',
                            color: '#ea580c',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <AlertTriangle size={14} /> Minta Revisi
                        </button>

                        <button
                          type="button"
                          onClick={() => openActionModal(sub, 'TOLAK')}
                          style={{
                            minHeight: 38,
                            padding: '7px 14px',
                            borderRadius: 8,
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#dc2626',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <XCircle size={14} /> Tolak
                        </button>

                        <button
                          type="button"
                          onClick={() => openActionModal(sub, 'APPROVE')}
                          style={{
                            minHeight: 38,
                            padding: '7px 16px',
                            borderRadius: 8,
                            border: 'none',
                            background: '#16a34a',
                            color: '#ffffff',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)',
                          }}
                        >
                          <CheckCircle2 size={15} /> Setujui
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── EXPANDABLE ITEMS DETAIL ── */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #f1f5f9', background: '#fafafa', padding: '16px 18px' }}>
                    {loadingDetail || !expandedDetail ? (
                      <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                        <RefreshCw size={20} className="spin-icon" style={{ margin: '0 auto 6px' }} />
                        <span style={{ fontSize: '0.8rem' }}>Mengambil rincian produk...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                            Daftar Produk Masuk ({expandedDetail.items.length} jenis)
                          </h4>
                          <span style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 700 }}>
                            Total HPP: Rp{' '}
                            {expandedDetail.items
                              .reduce((sum, it) => sum + Number(it.costPrice) * it.qty, 0)
                              .toLocaleString('id-ID')}
                          </span>
                        </div>

                        {/* Tabel Produk (Desktop) */}
                        <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ background: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ padding: '8px 10px', borderRadius: '6px 0 0 6px' }}>Nama Produk</th>
                                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Qty</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Harga Beli (HPP)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Subtotal</th>
                                <th style={{ padding: '8px 10px' }}>Kedaluwarsa</th>
                                <th style={{ padding: '8px 10px' }}>Kode Batch</th>
                                <th style={{ padding: '8px 10px', borderRadius: '0 6px 6px 0' }}>Kondisi Fisik</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedDetail.items.map((it, idx) => {
                                const subtotal = Number(it.costPrice) * it.qty;
                                return (
                                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                                    <td style={{ padding: '10px 10px', fontWeight: 700, color: '#0f172a' }}>
                                      <div>{it.productName}</div>
                                      {it.productIsActive === false && (
                                        <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                          <span
                                            style={{
                                              padding: '2px 6px',
                                              borderRadius: 4,
                                              background: '#ede9fe',
                                              color: '#6d28d9',
                                              fontSize: '0.66rem',
                                              fontWeight: 800,
                                            }}
                                          >
                                            PRODUK BARU
                                          </span>
                                          {it.productCategoryName && (
                                            <span style={{ fontSize: '0.68rem', color: '#475569' }}>
                                              Kategori: {it.productCategoryName}
                                            </span>
                                          )}
                                          {it.productSellingPrice !== undefined && (
                                            <span style={{ fontSize: '0.68rem', color: '#047857', fontWeight: 700 }}>
                                              Usulan Harga Jual: Rp {Math.round(Number(it.productSellingPrice)).toLocaleString('id-ID')}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 800, color: '#15803d' }}>
                                      {it.qty}
                                    </td>
                                    <td style={{ padding: '10px 10px', textAlign: 'right', color: '#334155' }}>
                                      Rp {Number(it.costPrice).toLocaleString('id-ID')}
                                    </td>
                                    <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                      Rp {subtotal.toLocaleString('id-ID')}
                                    </td>
                                    <td style={{ padding: '10px 10px' }}>
                                      {it.expiryDate ? (
                                        <span style={{ color: '#d97706', fontWeight: 600 }}>{it.expiryDate}</span>
                                      ) : (
                                        <span style={{ color: '#94a3b8' }}>—</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 10px', fontFamily: 'monospace', color: '#475569' }}>
                                      {it.batchCode}
                                    </td>
                                    <td style={{ padding: '10px 10px', color: '#64748b', fontSize: '0.75rem' }}>
                                      {it.conditionNote || '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Kartu Produk (Mobile) */}
                        <div className="rep-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {expandedDetail.items.map((it, idx) => {
                            const subtotal = Number(it.costPrice) * it.qty;
                            return (
                              <div key={idx} className="rep-mcard">
                                <div className="rep-mcard__top">
                                  <div>
                                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#0f172a' }}>
                                      {it.productName}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                                      Batch: {it.batchCode}
                                    </div>
                                  </div>
                                  {it.productIsActive === false && (
                                    <span
                                      style={{
                                        padding: '2px 7px',
                                        borderRadius: 6,
                                        background: '#ede9fe',
                                        color: '#6d28d9',
                                        fontSize: '0.68rem',
                                        fontWeight: 800,
                                        flexShrink: 0,
                                      }}
                                    >
                                      PRODUK BARU
                                    </span>
                                  )}
                                </div>
                                <div className="rep-mcard__grid">
                                  <div>
                                    <div className="rep-mcard__k">Qty</div>
                                    <div className="rep-mcard__v" style={{ color: '#15803d' }}>
                                      {it.qty} {it.productUnit || 'pcs'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="rep-mcard__k">Harga Beli</div>
                                    <div className="rep-mcard__v">Rp {Number(it.costPrice).toLocaleString('id-ID')}</div>
                                  </div>
                                  <div>
                                    <div className="rep-mcard__k">Subtotal</div>
                                    <div className="rep-mcard__v">Rp {subtotal.toLocaleString('id-ID')}</div>
                                  </div>
                                  <div>
                                    <div className="rep-mcard__k">Kedaluwarsa</div>
                                    <div className="rep-mcard__v" style={{ color: it.expiryDate ? '#d97706' : '#94a3b8' }}>
                                      {it.expiryDate || '—'}
                                    </div>
                                  </div>
                                </div>
                                {(it.conditionNote || (it.productIsActive === false && it.productSellingPrice !== undefined)) && (
                                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9', fontSize: '0.74rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {it.productIsActive === false && it.productSellingPrice !== undefined && (
                                      <span style={{ color: '#047857', fontWeight: 700 }}>
                                        Usulan Harga Jual: Rp {Math.round(Number(it.productSellingPrice)).toLocaleString('id-ID')}
                                      </span>
                                    )}
                                    {it.conditionNote && <span>Kondisi: {it.conditionNote}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
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
      ) : mainSection === 'FEFO' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── FILTER LAPORAN KONDISI & SEARCH BAR ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="rep-chip-bar">
              {[
                { id: 'SUBMITTED', label: 'Menunggu Keputusan', badge: pendingFefoCount > 0 ? pendingFefoCount : null },
                { id: 'APPROVED', label: 'Disetujui / Diskon Aktif' },
                { id: 'semua', label: 'Semua Laporan' },
              ].map((tab) => {
                const isActive = fefoStatusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`rep-chip${isActive ? ' active' : ''}`}
                    onClick={() => setFefoStatusFilter(tab.id as typeof fefoStatusFilter)}
                  >
                    <span>{tab.label}</span>
                    {tab.badge !== null && tab.badge !== undefined && (
                      <span
                        style={{
                          backgroundColor: '#ef4444',
                          color: '#ffffff',
                          borderRadius: 999,
                          padding: '1px 6px',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          marginLeft: 4,
                        }}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Tombol Export Excel Rekap */}
              <button
                type="button"
                onClick={handleExportFefoExcel}
                disabled={loadingFefo || exportingFefoExcel || fefoReports.length === 0}
                style={{
                  minHeight: 40,
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#18181b',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: (loadingFefo || exportingFefoExcel || fefoReports.length === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                  whiteSpace: 'nowrap',
                }}
              >
                {exportingFefoExcel ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" />
                    <span>Mengekspor...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={15} color="#86efac" />
                    <span>Unduh Rekap (.xlsx)</span>
                  </>
                )}
              </button>

              {/* Search Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '6px 12px', minWidth: 'min(100%, 220px)', minHeight: 40 }}>
                <Search size={15} color="#64748b" />
                <input
                  type="text"
                  placeholder="Cari produk / batch..."
                  value={fefoSearch}
                  onChange={(e) => setFefoSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchFefoReports(fefoStatusFilter);
                  }}
                  style={{ border: 'none', outline: 'none', fontSize: '0.82rem', width: '100%', background: 'transparent' }}
                />
              </div>
            </div>
          </div>

          {/* ── DAFTAR LAPORAN KONDISI ── */}
          {loadingFefo ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <RefreshCw size={28} className="spin-icon" style={{ margin: '0 auto 12px' }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Memuat laporan kondisi fisik...</p>
            </div>
          ) : fefoReports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <Flame size={48} color="#cbd5e1" style={{ margin: '0 auto 14px' }} />
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: '#1e293b' }}>
                {fefoStatusFilter === 'SUBMITTED' ? 'Tidak Ada Laporan Menunggu' : 'Belum Ada Laporan Kondisi'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                {fefoStatusFilter === 'SUBMITTED'
                  ? 'Semua laporan pemeriksaan batch kedaluwarsa sudah ditindaklanjuti.'
                  : `Belum ada laporan pada filter "${fefoStatusFilter}".`}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {fefoReports.map((rep) => {
                const normalPrice = Number(rep.sellingPrice);
                const discountPct = Number(rep.approvedDiscountPct || rep.suggestedDiscountPct || 0);
                const discountedPrice =
                  rep.discountedPrice ?? computeFefoDiscountedPrice(normalPrice, discountPct);

                return (
                  <div
                    key={rep.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: 14,
                      border: rep.status === 'SUBMITTED' ? '1.5px solid #fb923c' : rep.status === 'APPROVED' ? '1px solid #86efac' : '1px solid #e2e8f0',
                      boxShadow: rep.status === 'SUBMITTED' ? '0 4px 12px rgba(249, 115, 22, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                      padding: '16px 18px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {/* Header Item */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                          {rep.productName}
                        </span>
                        {renderAlertBadge(rep.alertLevel)}
                        {renderFefoStatusBadge(rep.status)}
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Batch: <code style={{ fontWeight: 700, color: '#334155' }}>{rep.batchCode}</code> • Exp: <strong style={{ color: '#b91c1c' }}>{rep.expiryDate}</strong>
                      </span>
                    </div>

                    {/* Ringkasan Stok & Harga */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 10,
                        background: '#f8fafc',
                        padding: '10px 14px',
                        borderRadius: 10,
                        fontSize: '0.82rem',
                      }}
                    >
                      <div>
                        <span style={{ color: '#64748b' }}>Sisa Batch di Rak: </span>
                        <strong style={{ color: '#0f172a' }}>{rep.currentBatchQty} {rep.productUnit}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>Harga Normal: </span>
                        <strong style={{ color: '#0f172a' }}>{formatRupiah(normalPrice)}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#64748b' }}>Usulan Gudang: </span>
                        <strong style={{ color: '#ea580c' }}>{rep.gudangSuggestion || '—'} {rep.suggestedDiscountPct ? `(${rep.suggestedDiscountPct}%)` : ''}</strong>
                      </div>
                    </div>

                    {/* Hasil Cek Fisik Gudang */}
                    {rep.physicalCondition && (
                      <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fef3c7', fontSize: '0.8rem', color: '#92400e' }}>
                        <strong>Catatan Fisik Gudang: </strong>
                        <span>&quot;{rep.physicalCondition}&quot;</span>
                      </div>
                    )}

                    {/* Jika Sudah Disetujui Manager */}
                    {rep.status === 'APPROVED' && (
                      <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#166534' }}>
                              KEPUTUSAN: {formatDecisionLabel(rep.managerDecision)}
                            </span>
                            {rep.approvedDiscountPct && (
                              <span style={{ background: '#dc2626', color: '#ffffff', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 900 }}>
                                {rep.approvedDiscountPct}% OFF
                              </span>
                            )}
                          </div>
                          {rep.discountBarcode && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#15803d', flexWrap: 'wrap' }}>
                              <Barcode size={16} />
                              <span>Barcode Diskon: <code style={{ fontWeight: 800, background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>{rep.discountBarcode}</code></span>
                              <span style={{ color: '#64748b' }}>({formatRupiah(discountedPrice)})</span>
                            </div>
                          )}
                          {rep.managerNote && (
                            <span style={{ fontSize: '0.76rem', color: '#4b5563' }}>
                              Instruksi: {rep.managerNote}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Jika Menunggu Keputusan: Tombol Eksekusi Manager */}
                    {rep.status === 'SUBMITTED' && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                        <button
                          type="button"
                          onClick={() => {
                            const expiredNow = Boolean(
                              rep.isExpired ||
                                (rep.expiryDate && rep.expiryDate < getTodayWibIsoManager()),
                            );
                            const sug = (rep.gudangSuggestion || '').toUpperCase();
                            setSelectedFefo(rep);
                            setFefoDecisionError(null);
                            setApprovedDiscountPct(Number(rep.suggestedDiscountPct) || 30);
                            if (expiredNow) {
                              setFefoDecision(sug.includes('RETUR') ? 'RETURN_SUPPLIER' : 'DESTROY');
                            } else if (sug.includes('MUSNAH') || sug.includes('DISPOSE') || sug.includes('WRITE-OFF')) {
                              setFefoDecision('DESTROY');
                            } else if (sug.includes('RETUR') || sug.includes('RETURN')) {
                              setFefoDecision('RETURN_SUPPLIER');
                            } else if (sug.includes('PINDAH') || sug.includes('RAK DEPAN') || sug.includes('RELOCATE')) {
                              setFefoDecision('DISPLAY_FRONT');
                            } else {
                              setFefoDecision('DISCOUNT');
                            }
                          }}
                          style={{
                            padding: '9px 18px',
                            borderRadius: 10,
                            border: 'none',
                            background: '#ea580c',
                            color: '#ffffff',
                            fontSize: '0.82rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            boxShadow: '0 2px 6px rgba(234, 88, 12, 0.25)',
                          }}
                        >
                          <Zap size={15} />
                          <span>Tetapkan Keputusan Manager</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : mainSection === 'SUPPLIERS' ? (
        /* ── KONTEN DATABASE SUPPLIER (FASE 5.2 & 5.4) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Top Bar Filter & Tambah Supplier */}
          <div
            style={{
              background: '#ffffff',
              padding: '16px 20px',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            {/* Search Input */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 10,
                padding: '8px 14px',
                flex: '1 1 280px',
                maxWidth: 420,
              }}
            >
              <Search size={16} color="#64748b" />
              <input
                type="text"
                placeholder="Cari pemasok berdasarkan nama / kontak / alamat..."
                value={supplierSearch}
                onChange={(e) => {
                  setSupplierSearch(e.target.value);
                  fetchSuppliers(e.target.value);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '0.84rem',
                  color: '#0f172a',
                  width: '100%',
                }}
              />
              {supplierSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setSupplierSearch('');
                    fetchSuppliers('');
                  }}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                >
                  <X size={14} color="#94a3b8" />
                </button>
              )}
            </div>

            {/* Tombol Tambah Supplier */}
            <button
              type="button"
              onClick={() => {
                setEditingSupplier(null);
                setSupplierForm({
                  name: '',
                  contactPerson: '',
                  phone: '',
                  address: '',
                  notes: '',
                  isActive: true,
                });
                setSupplierError(null);
                setIsSupplierModalOpen(true);
              }}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: '#16a34a',
                color: '#ffffff',
                fontSize: '0.84rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
              }}
            >
              <Plus size={16} />
              <span>Tambah Pemasok Baru</span>
            </button>
          </div>

          {/* List Pemasok Grid */}
          {loadingSuppliers ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              <RefreshCw size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: '0.88rem' }}>Memuat data pemasok...</p>
            </div>
          ) : suppliers.length === 0 ? (
            <div
              style={{
                background: '#ffffff',
                borderRadius: 14,
                border: '1.5px dashed #cbd5e1',
                padding: '48px 24px',
                textAlign: 'center',
                color: '#64748b',
              }}
            >
              <Building2 size={40} color="#94a3b8" style={{ margin: '0 auto 12px' }} />
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: '#334155' }}>
                {supplierSearch ? 'Tidak Ada Pemasok yang Sesuai' : 'Belum Ada Data Pemasok'}
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#64748b' }}>
                {supplierSearch
                  ? `Tidak ditemukan hasil pencarian untuk "${supplierSearch}".`
                  : 'Daftarkan pemasok / distributor resmi agar dapat dipilih saat penerimaan barang gudang.'}
              </p>
              {!supplierSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSupplier(null);
                    setSupplierForm({
                      name: '',
                      contactPerson: '',
                      phone: '',
                      address: '',
                      notes: '',
                      isActive: true,
                    });
                    setSupplierError(null);
                    setIsSupplierModalOpen(true);
                  }}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Plus size={15} />
                  <span>Tambah Pemasok Pertama</span>
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
              {suppliers.map((sup) => (
                <div
                  key={sup.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: 14,
                    border: sup.isActive ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    opacity: sup.isActive ? 1 : 0.75,
                  }}
                >
                  <div>
                    {/* Header Card */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: sup.isActive ? '#dcfce7' : '#f1f5f9',
                            color: sup.isActive ? '#16a34a' : '#64748b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Building2 size={18} />
                        </div>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
                            {sup.name}
                          </h4>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            Didaftarkan: {new Date(sup.createdAt).toLocaleDateString('id-ID')}
                          </span>
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          background: sup.isActive ? '#dcfce7' : '#f1f5f9',
                          color: sup.isActive ? '#15803d' : '#64748b',
                        }}
                      >
                        {sup.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>

                    {/* Detail Kontak & Alamat */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', color: '#334155', background: '#f8fafc', padding: 10, borderRadius: 8 }}>
                      {sup.contactPerson && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#64748b', fontWeight: 600 }}>PIC:</span>
                          <strong style={{ color: '#0f172a' }}>{sup.contactPerson}</strong>
                        </div>
                      )}
                      {sup.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Phone size={13} color="#64748b" />
                          <a
                            href={`https://wa.me/${sup.phone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#15803d', textDecoration: 'none', fontWeight: 700 }}
                          >
                            {sup.phone}
                          </a>
                        </div>
                      )}
                      {sup.address && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <MapPin size={13} color="#64748b" style={{ flexShrink: 0, marginTop: 2 }} />
                          <span style={{ color: '#475569', lineHeight: 1.3 }}>{sup.address}</span>
                        </div>
                      )}
                      {sup.notes && (
                        <div style={{ marginTop: 2, paddingTop: 4, borderTop: '1px dashed #e2e8f0', fontSize: '0.75rem', color: '#64748b' }}>
                          <em>Ket: {sup.notes}</em>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tombol Aksi */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSupplier(sup);
                        setSupplierForm({
                          name: sup.name,
                          contactPerson: sup.contactPerson || '',
                          phone: sup.phone || '',
                          address: sup.address || '',
                          notes: sup.notes || '',
                          isActive: sup.isActive,
                        });
                        setSupplierError(null);
                        setIsSupplierModalOpen(true);
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#334155',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Edit size={13} />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSupplier({ id: sup.id, name: sup.name })}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Hapus</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : isManager ? (
        /* ── KONTEN LAPORAN MUTASI STOK (EXCEL SPREADSHEET HITAM PUTIH CLEAN) ── */
        <LaporanMutasiStokSection />
      ) : null}

      {/* ── MODAL KONFIRMASI AKSI MANAGER ── */}
      {actionType && selectedSub && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !processingAction && setActionType(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 520,
              width: '100%',
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: '24px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 25px 30px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background:
                    actionType === 'APPROVE'
                      ? '#dcfce7'
                      : actionType === 'REVISI'
                        ? '#fff7ed'
                        : '#fee2e2',
                  color:
                    actionType === 'APPROVE'
                      ? '#15803d'
                      : actionType === 'REVISI'
                        ? '#ea580c'
                        : '#b91c1c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {actionType === 'APPROVE' && <CheckCircle2 size={24} />}
                {actionType === 'REVISI' && <AlertTriangle size={24} />}
                {actionType === 'TOLAK' && <XCircle size={24} />}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  {actionType === 'APPROVE' && 'Setujui Penerimaan Barang'}
                  {actionType === 'REVISI' && 'Minta Revisi ke Petugas Gudang'}
                  {actionType === 'TOLAK' && 'Tolak Penerimaan Barang'}
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace' }}>
                  {selectedSub.receiveNumber} • Penginput: {selectedSub.creatorName}
                </span>
              </div>
            </div>

            {actionError && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.8rem' }}>
                {actionError}
              </div>
            )}

            {/* Content Text / Instructions */}
            {actionType === 'APPROVE' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5, background: '#f8fafc', padding: 14, borderRadius: 10 }}>
                  <p style={{ margin: '0 0 8px 0' }}>
                    Dengan menyetujui penerimaan barang ini:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#475569' }}>
                    <li>Batch stok baru akan dibuat dan langsung aktif di gudang.</li>
                    <li>Usulan produk baru (jika ada) akan <strong>langsung diaktifkan</strong> &amp; stok produk di kasir <strong>langsung bertambah</strong>.</li>
                    <li>Tindakan persetujuan akan tercatat di riwayat perubahan stok.</li>
                  </ul>
                </div>

                {/* Penyesuaian Harga Jual Final untuk Usulan Produk Baru */}
                {approvePreviewItems.some((it) => it.productIsActive === false) && (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: '#f5f3ff',
                      border: '1px solid #c4b5fd',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#5b21b6' }}>
                      Konfirmasi Harga Usulan Produk Baru Sebelum Diaktifkan di Kasir:
                    </div>
                    {approvePreviewItems
                      .filter((it) => it.productIsActive === false)
                      .map((it) => {
                        const edit = approvePriceEdits[it.productId] ?? {
                          sellingPrice: String(Math.round(Number(it.productSellingPrice ?? 0))),
                          costPrice: String(Math.round(Number(it.costPrice ?? 0))),
                        };
                        return (
                          <div key={it.productId} style={{ background: '#ffffff', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd6fe' }}>
                            <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#0f172a', marginBottom: 6 }}>
                              {it.productName} ({it.qty} {it.productUnit || 'pcs'} &bull; ED: {it.expiryDate || '—'})
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#475569', marginBottom: 2 }}>
                                  HPP Final (Rp)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  value={edit.costPrice}
                                  onChange={(e) =>
                                    setApprovePriceEdits((prev) => ({
                                      ...prev,
                                      [it.productId]: { ...edit, costPrice: e.target.value },
                                    }))
                                  }
                                  style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
                                />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#047857', marginBottom: 2 }}>
                                  Harga Jual Kasir (Rp) *
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={edit.sellingPrice}
                                  onChange={(e) =>
                                    setApprovePriceEdits((prev) => ({
                                      ...prev,
                                      [it.productId]: { ...edit, sellingPrice: e.target.value },
                                    }))
                                  }
                                  style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1.5px solid #10b981', fontSize: '0.84rem', fontWeight: 700 }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  {actionType === 'REVISI' ? 'Catatan Revisi untuk Petugas Gudang *' : 'Alasan Penolakan Kiriman *'}
                </label>
                <textarea
                  rows={4}
                  placeholder={
                    actionType === 'REVISI'
                      ? 'Contoh: Jumlah barang fisik tidak sesuai surat jalan, tolong hitung ulang batch 2.'
                      : 'Contoh: Kemasan basah dan sobek parah, supplier sepakat untuk retur total.'
                  }
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <button
                type="button"
                disabled={processingAction}
                onClick={() => setActionType(null)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>

              <button
                type="button"
                disabled={processingAction}
                onClick={handleExecuteAction}
                style={{
                  padding: '9px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background:
                    actionType === 'APPROVE'
                      ? '#16a34a'
                      : actionType === 'REVISI'
                        ? '#ea580c'
                        : '#dc2626',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {processingAction ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    {actionType === 'APPROVE' && <CheckCircle2 size={16} />}
                    {actionType === 'APPROVE' ? 'Konfirmasi Persetujuan' : actionType === 'REVISI' ? 'Kirim Catatan Revisi' : 'Tolak Pengajuan'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL KEPUTUSAN PENANGANAN STOK & DISKON ── */}
      {selectedFefo && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !submittingFefoDecision && setSelectedFefo(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 500,
              width: '100%',
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: '24px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 25px 30px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#ffedd5',
                    color: '#ea580c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    Keputusan Penanganan Stok
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                    Tetapkan diskon obral, pindah rak depan, retur, atau pemusnahan.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup modal keputusan"
                onClick={() => setSelectedFefo(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Ringkasan Produk */}
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 10, fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>{selectedFefo.productName}</div>
              <div style={{ color: '#64748b', marginTop: 2 }}>
                Batch: {selectedFefo.batchCode} • ED: {selectedFefo.expiryDate} • Sisa: {selectedFefo.currentBatchQty} {selectedFefo.productUnit}
              </div>
              <div style={{ color: '#047857', marginTop: 4, fontStyle: 'italic' }}>
                Laporan Gudang: &quot;{selectedFefo.physicalCondition}&quot; ({selectedFefo.gudangSuggestion})
              </div>
            </div>

            {/* Peringatan Keras Jika Batch Sudah Kedaluwarsa */}
            {(selectedFefo.isExpired || (selectedFefo.expiryDate && selectedFefo.expiryDate < getTodayWibIsoManager())) && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#fef2f2',
                  border: '1.5px solid #ef4444',
                  color: '#991b1b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                BATCH SUDAH KEDALUWARSA (ED: {selectedFefo.expiryDate}). Opsi Diskon &amp; Rak Depan dikunci otomatis; pilih <strong>Pemusnahan</strong> atau <strong>Retur Supplier</strong> agar stok dinolkan.
              </div>
            )}

            {/* Pilihan Keputusan */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Pilih Keputusan *
              </label>
              <select
                className="form-select"
                value={fefoDecision}
                onChange={(e) => setFefoDecision(e.target.value as ManagerDecision)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                }}
              >
                {!(selectedFefo.isExpired || (selectedFefo.expiryDate && selectedFefo.expiryDate < getTodayWibIsoManager())) && (
                  <>
                    <option value="DISCOUNT">Setujui Diskon Obral (Otomatis Buat Barcode Diskon)</option>
                    <option value="DISPLAY_FRONT">Pindahkan ke Rak Depan Kasir (Jual Normal)</option>
                  </>
                )}
                <option value="DESTROY">Setujui Pemusnahan (Tarik &amp; Nolkan Stok)</option>
                <option value="RETURN_SUPPLIER">Setujui Retur ke Supplier (Tarik &amp; Nolkan Stok)</option>
                <option value="HOLD">Tahan Sementara (Pantau Kondisi)</option>
              </select>
            </div>

            {/* Jika Keputusan DISCOUNT & BELUM expired: Input Persentase & Preview Barcode */}
            {fefoDecision === 'DISCOUNT' &&
              !(selectedFefo.isExpired || (selectedFefo.expiryDate && selectedFefo.expiryDate < getTodayWibIsoManager())) && (
              <div style={{ background: '#fef2f2', padding: '12px 14px', borderRadius: 10, border: '1px solid #fecaca' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#991b1b' }}>
                    Besaran Diskon Disetujui:
                  </span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#dc2626' }}>
                    {approvedDiscountPct}% OFF
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  step={5}
                  value={approvedDiscountPct}
                  onChange={(e) => setApprovedDiscountPct(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#dc2626' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: 4 }}>
                  <span style={{ color: '#64748b' }}>Harga Awal: {formatRupiah(selectedFefo.sellingPrice)}</span>
                  <span style={{ fontWeight: 800, color: '#dc2626' }}>
                    Harga Baru: {formatRupiah(computeFefoDiscountedPrice(Number(selectedFefo.sellingPrice), approvedDiscountPct))}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#7f1d1d', lineHeight: 1.4 }}>
                  * Sistem otomatis membuat kode barcode diskon khusus untuk dipindai di kasir.
                </p>
              </div>
            )}

            {/* Catatan / Instruksi Tambahan */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Instruksi Manager ke Petugas Gudang (Opsional)
              </label>
              <textarea
                rows={2}
                value={managerFefoNote}
                onChange={(e) => setManagerFefoNote(e.target.value)}
                placeholder="Misal: Tempel stiker diskon di rak obral depan pintu masuk..."
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {fefoDecisionError && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: '0.8rem' }}>
                {fefoDecisionError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setSelectedFefo(null)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submittingFefoDecision}
                onClick={handleExecuteFefoDecision}
                style={{
                  padding: '9px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#ea580c',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {submittingFefoDecision ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Simpan Keputusan</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL TAMBAH / EDIT SUPPLIER (FASE 5) ── */}
      {isSupplierModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !submittingSupplier && setIsSupplierModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 520,
              width: '100%',
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: '24px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 25px 30px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    background: '#dcfce7',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Building2 size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    {editingSupplier ? 'Edit Data Pemasok' : 'Tambah Pemasok Baru'}
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    Pemasok resmi untuk pengadaan dan penerimaan barang gudang
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSupplierModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            {supplierError && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.8rem' }}>
                {supplierError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSaveSupplier} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Nama Pemasok / Distributor *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: PT. Sumber Pangan Jaya / Koperasi Mahasiswa"
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Nama Kontak (PIC)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Pak Budi"
                    value={supplierForm.contactPerson}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.84rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    No. Telepon / WA
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 081234567890"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.84rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Alamat Kantor / Gudang
                </label>
                <textarea
                  rows={2}
                  placeholder="Contoh: Jl. Mayjen Sungkono KM 5, Purbalingga"
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Catatan / Ketentuan Retur
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Retur maksimal H-3 sebelum expired, tempo 14 hari"
                  value={supplierForm.notes}
                  onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="supplierIsActive"
                  checked={supplierForm.isActive}
                  onChange={(e) => setSupplierForm({ ...supplierForm, isActive: e.target.checked })}
                  style={{ accentColor: '#16a34a', width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="supplierIsActive" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                  Status Aktif (dapat dipilih langsung oleh petugas gudang)
                </label>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  disabled={submittingSupplier}
                  onClick={() => setIsSupplierModalOpen(false)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingSupplier}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: submittingSupplier ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                  }}
                >
                  {submittingSupplier ? (
                    <>
                      <RefreshCw size={14} className="spin-icon" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>{editingSupplier ? 'Simpan Perubahan' : 'Tambahkan Pemasok'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL KONFIRMASI HAPUS PEMASOK ── */}
      {confirmDeleteSupplier && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !deletingSupplier && setConfirmDeleteSupplier(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              maxWidth: 420,
              width: '100%',
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 25px 30px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                  Hapus Pemasok?
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Data pemasok <strong>{confirmDeleteSupplier.name}</strong> akan dihapus dari daftar aktif.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                disabled={deletingSupplier}
                onClick={() => setConfirmDeleteSupplier(null)}
                style={{
                  minHeight: 40,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingSupplier}
                onClick={handleConfirmDeleteSupplier}
                style={{
                  minHeight: 40,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: deletingSupplier ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {deletingSupplier ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Hapus Pemasok</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
