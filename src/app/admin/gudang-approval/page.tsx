'use client';
// =============================================================
// src/app/admin/gudang-approval/page.tsx
// Portal Approval Penerimaan Barang Masuk (Manager Only) — Wiramart v3.0
// STANDAR: 2-Layer Executive Separation, Zero-Trust ACID Verification, Clean UI
// =============================================================

import { useState, useEffect } from 'react';
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Eye,
  Send,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  Layers,
  ShieldCheck,
  Building2,
  Calendar,
  Flame,
  Zap,
  Tag,
  Barcode,
  Sparkles,
  Plus,
  Phone,
  MapPin,
  Edit,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';

import { formatRupiah } from '@/lib/utils/helpers';
import LaporanMutasiStokSection from '@/app/admin/laporan/LaporanMutasiStokSection';

type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';

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
};

type ItemDetail = {
  id: string;
  productId: string;
  productName: string;
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
  discountBarcode?: string | null;
  discountedPrice?: number | null;
};

export default function GudangApprovalPage() {
  // Top Level Section Switch
  const [mainSection, setMainSection] = useState<'PENERIMAAN' | 'FEFO' | 'SUPPLIERS' | 'MUTASI'>('PENERIMAAN');

  // ── State MOD (Manager on Duty) ──────────────────────────────
  const [modStatus, setModStatus] = useState<{
    isCheckedIn: boolean;
    isCheckedOut: boolean;
    managerName: string | null;
  } | null>(null);
  const [checkingInMod, setCheckingInMod] = useState(false);

  // ── State Database Supplier (Fase 5.2 & 5.4) ─────────────────
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

  // ── Ekspor Rekap Laporan FEFO ke Excel (.xlsx) Tabel Hitam Putih Clean ──
  async function handleExportFefoExcel() {
    if (!fefoReports || fefoReports.length === 0) {
      alert('Tidak ada data laporan FEFO untuk diekspor pada filter ini.');
      return;
    }
    setExportingFefoExcel(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Wiramart UNPERBA';
      wb.lastModifiedBy = 'Manager Gudang';
      wb.created = new Date();

      const ws = wb.addWorksheet('Rekap Laporan FEFO', {
        views: [{ showGridLines: true }],
      });

      // ── BARIS 1: Header Utama Perusahaan (Hitam #18181B) ──
      ws.mergeCells('A1:N1');
      const r1 = ws.getCell('A1');
      r1.value = 'WIRAMART — UKM KEWIRAUSAHAAN UNPERBA';
      r1.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
      r1.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 30;

      // ── BARIS 2: Judul Dokumen (Charcoal #27272A) ──
      ws.mergeCells('A2:N2');
      const r2 = ws.getCell('A2');
      r2.value = 'REKAP LAPORAN AUDIT FEFO, KEDALUWARSA & DISKON DARURAT';
      r2.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF27272A' } };
      r2.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 24;

      // ── BARIS 3: Metadata ──
      ws.mergeCells('A3:N3');
      const r3 = ws.getCell('A3');
      const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      const filterLabel =
        fefoStatusFilter === 'SUBMITTED'
          ? 'Menunggu Keputusan'
          : fefoStatusFilter === 'APPROVED'
            ? 'Telah Disetujui / Diskon Aktif'
            : 'Semua Laporan FEFO';
      r3.value = `Filter Status: ${filterLabel}   |   Dicetak: ${nowWib} WIB   |   Total Data: ${fefoReports.length} Laporan FEFO`;
      r3.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF52525B' } };
      r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
      r3.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } } };
      r3.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(3).height = 20;

      // Spacer row
      ws.getRow(4).height = 10;

      // ── BARIS 5: Headers ──
      const headers = [
        'No',
        'Nama Produk',
        'Kode Batch',
        'Tingkat Alert',
        'Tgl Expired (ED)',
        'Sisa di Rak',
        'Harga Normal (Rp)',
        'Catatan Fisik Gudang',
        'Usulan Gudang',
        'Status Laporan',
        'Keputusan Manager',
        'Diskon (%)',
        'Harga Diskon (Rp)',
        'Barcode Diskon / Catatan',
      ];

      ws.columns = [
        { key: 'no', width: 6 },
        { key: 'productName', width: 32 },
        { key: 'batchCode', width: 16 },
        { key: 'alertLevel', width: 16 },
        { key: 'expiryDate', width: 16 },
        { key: 'qty', width: 12 },
        { key: 'sellingPrice', width: 18 },
        { key: 'physicalCondition', width: 28 },
        { key: 'gudangSuggestion', width: 24 },
        { key: 'status', width: 22 },
        { key: 'managerDecision', width: 22 },
        { key: 'discountPct', width: 12 },
        { key: 'discountedPrice', width: 18 },
        { key: 'barcodeNote', width: 26 },
      ];

      const hRow = ws.getRow(5);
      hRow.values = headers;
      hRow.height = 26;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF3F3F46' } },
          right: { style: 'thin', color: { argb: 'FF3F3F46' } },
        };
      });

      // ── BARIS DATA ──
      fefoReports.forEach((rep, idx) => {
        const alertDesc =
          rep.alertLevel === 'H1'
            ? '🚨 H-1 Kritis (Besok ED)'
            : rep.alertLevel === 'H3'
              ? '⚠️ H-3 Urgent'
              : rep.alertLevel === 'H5'
                ? '⚡ H-5 Warning'
                : '👀 H-7 Watch';

        const statusDesc =
          rep.status === 'SUBMITTED'
            ? 'Menunggu Keputusan'
            : rep.status === 'APPROVED'
              ? 'Disetujui'
              : rep.status === 'REJECTED'
                ? 'Ditolak'
                : rep.status === 'EXECUTED'
                  ? 'Selesai / Terlaksana'
                  : 'Menunggu Cek';

        const decisionDesc =
          rep.managerDecision === 'DISCOUNT'
            ? 'Diskon Obral'
            : rep.managerDecision === 'DISPLAY_FRONT'
              ? 'Pajang Depan'
              : rep.managerDecision === 'DESTROY'
                ? 'Dimusnahkan (Basi)'
                : rep.managerDecision === 'RETURN_SUPPLIER'
                  ? 'Retur Pemasok'
                  : rep.managerDecision === 'HOLD'
                    ? 'Tahan'
                    : '—';

        const barcodeOrNote = rep.discountBarcode
          ? `Barcode: ${rep.discountBarcode}`
          : rep.managerNote || '—';

        const discPrice =
          rep.discountedPrice ||
          (rep.approvedDiscountPct
            ? Math.round(Number(rep.sellingPrice) * (1 - Number(rep.approvedDiscountPct) / 100))
            : 0);

        const row = ws.addRow({
          no: idx + 1,
          productName: rep.productName,
          batchCode: rep.batchCode,
          alertLevel: alertDesc,
          expiryDate: rep.expiryDate ? rep.expiryDate.slice(0, 10) : '—',
          qty: rep.currentBatchQty,
          sellingPrice: Number(rep.sellingPrice) || 0,
          physicalCondition: rep.physicalCondition || '—',
          gudangSuggestion: rep.gudangSuggestion || '—',
          status: statusDesc,
          managerDecision: decisionDesc,
          discountPct: rep.approvedDiscountPct ? `${Number(rep.approvedDiscountPct)}%` : '—',
          discountedPrice: discPrice > 0 ? discPrice : 0,
          barcodeNote: barcodeOrNote,
        });

        row.height = 20;
        const isZebra = idx % 2 === 1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
          cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF18181B' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isZebra ? 'FFF9FAFB' : 'FFFFFFFF' },
          };

          if (
            colNumber === 1 ||
            colNumber === 3 ||
            colNumber === 4 ||
            colNumber === 5 ||
            colNumber === 10 ||
            colNumber === 11 ||
            colNumber === 12
          ) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 2 || colNumber === 8 || colNumber === 9 || colNumber === 14) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          } else if (colNumber === 6) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else if (colNumber === 7 || colNumber === 13) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '"Rp "#,##0';
          }
        });
      });

      // ── BARIS SUMMARY TOTAL ──
      const totalQtyAll = fefoReports.reduce((s, r) => s + (Number(r.currentBatchQty) || 0), 0);
      const totalRow = ws.addRow({
        no: '',
        productName: `TOTAL BATCH KEDALUWARSA (${fefoReports.length} Laporan)`,
        batchCode: '',
        alertLevel: '',
        expiryDate: '',
        qty: totalQtyAll,
        sellingPrice: 0,
        physicalCondition: '',
        gudangSuggestion: '',
        status: '',
        managerDecision: '',
        discountPct: '',
        discountedPrice: 0,
        barcodeNote: '',
      });

      totalRow.height = 24;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totalRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E4E7' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'double', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FFD4D4D8' } },
          right: { style: 'thin', color: { argb: 'FFD4D4D8' } },
        };

        if (colNumber === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colNumber === 6) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0';
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      a.download = `Rekap_Laporan_FEFO_Wiramart_${todayStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor laporan FEFO ke Excel.');
    } finally {
      setExportingFefoExcel(false);
    }
  }

  // ── Ambil Status MOD Hari Ini ────────────────────────────────
  async function fetchModStatus() {
    try {
      const res = await fetch('/api/admin/duty');
      const json = await res.json();
      if (res.ok && json.success && json.data?.today) {
        setModStatus(json.data.today);
      }
    } catch {
      // silent
    }
  }

  // ── Check-In MOD Cepat ───────────────────────────────────────
  async function handleQuickCheckInMOD() {
    setCheckingInMod(true);
    try {
      const res = await fetch('/api/admin/duty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CHECK_IN' }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessToast(`Berhasil memulai Sesi Kerja Hari Ini!`);
        fetchModStatus();
      } else {
        alert(json.error ?? 'Gagal check-in MOD.');
      }
    } catch {
      alert('Kesalahan jaringan saat check-in MOD.');
    } finally {
      setCheckingInMod(false);
    }
  }

  // ── Ambil Daftar Supplier ────────────────────────────────────
  async function fetchSuppliers(query = supplierSearch) {
    setLoadingSuppliers(true);
    try {
      const params = new URLSearchParams({
        ...(query.trim() && { search: query.trim() }),
      });
      const res = await fetch(`/api/admin/suppliers?${params}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setSuppliers(json.data || []);
      }
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
  async function handleDeleteSupplier(id: string, name: string) {
    if (!confirm(`Hapus pemasok "${name}" dari sistem?`)) return;
    try {
      const res = await fetch(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessToast(`Pemasok "${name}" berhasil dihapus.`);
        fetchSuppliers();
      } else {
        alert(json.error ?? 'Gagal menghapus pemasok.');
      }
    } catch {
      alert('Gagal terhubung ke server.');
    }
  }


  // ── Ambil Daftar Pengajuan Penerimaan ─────────────────────────
  async function fetchSubmissions(filter = activeTab) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const statusParam = filter === 'semua' ? '' : `?status=${filter.toUpperCase()}`;
      const res = await fetch(`/api/gudang/penerimaan${statusParam}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal memuat antrian persetujuan');
      }
      setSubmissions(json.data.items || []);
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
      const params = new URLSearchParams({
        page: '1',
        limit: '100',
        ...(status !== 'semua' && { status }),
        ...(fefoSearch.trim() && { search: fefoSearch.trim() }),
      });
      const res = await fetch(`/api/gudang/fefo-alerts?${params}`);
      const json = await res.json();
      if (json.success && json.data) {
        setFefoReports(json.data.items || []);
      }
    } catch {
      // silent
    } finally {
      setLoadingFefo(false);
    }
  }

  useEffect(() => {
    fetchModStatus();
  }, []);

  useEffect(() => {
    if (mainSection === 'PENERIMAAN') {
      fetchSubmissions(activeTab);
    } else if (mainSection === 'FEFO') {
      fetchFefoReports(fefoStatusFilter);
    } else if (mainSection === 'SUPPLIERS') {
      fetchSuppliers();
    }
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
          `✅ Diskon ${approvedDiscountPct}% disetujui! Barcode override diterbitkan: ${json.data.discountBarcode}`,
        );
      } else {
        setSuccessToast(`✅ Keputusan ${fefoDecision} berhasil ditetapkan untuk produk ${selectedFefo.productName}.`);
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
      const res = await fetch(`/api/gudang/penerimaan/${subId}`);
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
  function openActionModal(sub: SubmissionItem, type: 'APPROVE' | 'REVISI' | 'TOLAK') {
    setSelectedSub(sub);
    setActionType(type);
    setActionNote('');
    setActionError(null);
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
      let body: Record<string, string> | undefined = undefined;

      if (actionType === 'APPROVE') {
        endpoint = `/api/admin/gudang/penerimaan/${selectedSub.id}/approve`;
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
          ? `✅ Penerimaan #${selectedSub.receiveNumber} disetujui! Stok telah ditambahkan ke kasir.`
          : actionType === 'REVISI'
            ? `🔄 Draft #${selectedSub.receiveNumber} dikembalikan ke petugas gudang untuk direvisi.`
            : `❌ Penerimaan #${selectedSub.receiveNumber} ditolak. Stok dibatalkan.`,
      );

      setActionType(null);
      setSelectedSub(null);
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
            🚨 H-1 Kritis (Besok ED)
          </span>
        );
      case 'H3':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#ffedd5', color: '#c2410c' }}>
            ⚠️ H-3 Urgent
          </span>
        );
      case 'H5':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#fef3c7', color: '#b45309' }}>
            ⚡ H-5 Warning
          </span>
        );
      case 'H7':
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, background: '#f1f5f9', color: '#475569' }}>
            👀 H-7 Watch
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
              background: '#e0f2fe',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
              Portal Otoritas & Persetujuan Manager
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              Wewenang eksklusif Manager untuk memvalidasi barang masuk dan menetapkan diskon darurat FEFO.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (mainSection === 'PENERIMAAN') fetchSubmissions(activeTab);
            else fetchFefoReports(fefoStatusFilter);
          }}
          style={{
            padding: '9px 14px',
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
          <RefreshCw size={14} className={loading || loadingFefo ? 'animate-spin' : ''} /> Segarkan Data
        </button>
      </div>

      {/* ── MOD ACTIVE STATUS / WARNING BANNER (PRD 4.1) ── */}
      {modStatus && (!modStatus.isCheckedIn || modStatus.isCheckedOut) ? (
        <div
          style={{
            background: '#fffbeb',
            border: '1.5px solid #f59e0b',
            borderRadius: 12,
            padding: '12px 18px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            boxShadow: '0 1px 3px rgba(245, 158, 11, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#fef3c7',
                color: '#d97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#92400e' }}>
                Perhatian: Belum Ada Sesi Kerja Hari Ini yang Aktif
              </div>
              <div style={{ fontSize: '0.76rem', color: '#b45309', marginTop: 2 }}>
                Persetujuan barang masuk (ACC) memerlukan Manager yang sudah memulai sesi kerja hari ini. Klik tombol di samping untuk memulai.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={checkingInMod}
            onClick={handleQuickCheckInMOD}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              background: '#d97706',
              color: '#ffffff',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.8rem',
              cursor: checkingInMod ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 6px rgba(217, 119, 6, 0.3)',
              whiteSpace: 'nowrap',
            }}
          >
            {checkingInMod ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Mulai Sesi Kerja Sekarang</span>
              </>
            )}
          </button>
        </div>
      ) : modStatus?.isCheckedIn ? (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: 10,
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.78rem',
            color: '#15803d',
            fontWeight: 700,
          }}
        >
          <ShieldCheck size={16} color="#16a34a" />
          <span>
            Sesi Kerja Aktif: <strong>{modStatus.managerName}</strong> — Seluruh wewenang ACC &amp; Diskon Darurat siap digunakan.
          </span>
        </div>
      ) : null}

      {/* ── TOP-LEVEL EXECUTIVE TAB SWITCHER ── */}
      <div style={{ display: 'flex', gap: 10, borderBottom: '2px solid #e2e8f0', paddingBottom: 2, overflowX: 'auto' }}>
        <button
          type="button"
          onClick={() => setMainSection('PENERIMAAN')}
          style={{
            padding: '10px 18px',
            fontSize: '0.88rem',
            fontWeight: 800,
            borderRadius: '10px 10px 0 0',
            border: 'none',
            background: mainSection === 'PENERIMAAN' ? '#0284c7' : 'transparent',
            color: mainSection === 'PENERIMAAN' ? '#ffffff' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <Truck size={17} />
          <span>Barang Masuk (ACC 2-Layer)</span>
          {pendingCount > 0 && (
            <span
              style={{
                background: mainSection === 'PENERIMAAN' ? '#ffffff' : '#0284c7',
                color: mainSection === 'PENERIMAAN' ? '#0284c7' : '#ffffff',
                padding: '2px 7px',
                borderRadius: 12,
                fontSize: '0.72rem',
                fontWeight: 900,
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setMainSection('FEFO');
            fetchFefoReports();
          }}
          style={{
            padding: '10px 18px',
            fontSize: '0.88rem',
            fontWeight: 800,
            borderRadius: '10px 10px 0 0',
            border: 'none',
            background: mainSection === 'FEFO' ? '#ea580c' : 'transparent',
            color: mainSection === 'FEFO' ? '#ffffff' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <Flame size={17} />
          <span>Persetujuan Diskon & FEFO</span>
          {pendingFefoCount > 0 && (
            <span
              style={{
                background: mainSection === 'FEFO' ? '#ffffff' : '#ea580c',
                color: mainSection === 'FEFO' ? '#ea580c' : '#ffffff',
                padding: '2px 7px',
                borderRadius: 12,
                fontSize: '0.72rem',
                fontWeight: 900,
              }}
            >
              {pendingFefoCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setMainSection('SUPPLIERS');
            fetchSuppliers();
          }}
          style={{
            padding: '10px 18px',
            fontSize: '0.88rem',
            fontWeight: 800,
            borderRadius: '10px 10px 0 0',
            border: 'none',
            background: mainSection === 'SUPPLIERS' ? '#16a34a' : 'transparent',
            color: mainSection === 'SUPPLIERS' ? '#ffffff' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <Building2 size={17} />
          <span>Database Supplier</span>
          {suppliers.length > 0 && (
            <span
              style={{
                background: mainSection === 'SUPPLIERS' ? '#ffffff' : '#16a34a',
                color: mainSection === 'SUPPLIERS' ? '#16a34a' : '#ffffff',
                padding: '2px 7px',
                borderRadius: 12,
                fontSize: '0.72rem',
                fontWeight: 900,
              }}
            >
              {suppliers.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setMainSection('MUTASI')}
          style={{
            padding: '10px 18px',
            fontSize: '0.88rem',
            fontWeight: 800,
            borderRadius: '10px 10px 0 0',
            border: 'none',
            background: mainSection === 'MUTASI' ? '#0f172a' : 'transparent',
            color: mainSection === 'MUTASI' ? '#ffffff' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <FileSpreadsheet size={17} />
          <span>Laporan Mutasi Stok (Excel)</span>
        </button>
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
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {[
          { id: 'submitted', label: 'Antrian Menunggu ACC', badge: pendingCount > 0 ? pendingCount : null },
          { id: 'semua', label: 'Semua Status' },
          { id: 'approved', label: 'Telah Disetujui' },
          { id: 'revised', label: 'Perlu Revisi' },
          { id: 'rejected', label: 'Ditolak' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              style={{
                padding: '9px 16px',
                borderRadius: 22,
                fontSize: '0.82rem',
                fontWeight: isActive ? 800 : 500,
                border: isActive ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                backgroundColor: isActive ? '#e0f2fe' : '#ffffff',
                color: isActive ? '#0369a1' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <span>{tab.label}</span>
              {tab.badge !== null && tab.badge !== undefined && (
                <span
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    borderRadius: 10,
                    padding: '1px 7px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
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
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px' }} />
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
            {activeTab === 'submitted' ? 'Semua Beres! Tidak Ada Antrian Menunggu ACC' : 'Tidak Ada Data Penerimaan'}
          </h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
            {activeTab === 'submitted'
              ? 'Seluruh kiriman barang yang diajukan petugas gudang telah Anda tindak lanjuti.'
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
                      ? '1.5px solid #38bdf8'
                      : sub.status === 'APPROVED'
                        ? '1px solid #bbf7d0'
                        : sub.status === 'REVISED'
                          ? '1px solid #fed7aa'
                          : '1px solid #e2e8f0',
                  boxShadow: sub.status === 'SUBMITTED' ? '0 4px 12px rgba(2, 132, 199, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
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
                      <span style={{ color: '#64748b' }}>No. Surat Jalan: </span>
                      <strong style={{ color: '#0f172a' }}>{sub.deliveryNote || '—'}</strong>
                    </div>
                  </div>

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
                        color: '#0284c7',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: 0,
                      }}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {isExpanded ? 'Tutup Rincian Item' : 'Buka & Periksa Rincian Item'}
                    </button>

                    {/* Tombol Otorisasi Manager (Hanya aktif saat status SUBMITTED) */}
                    {sub.status === 'SUBMITTED' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openActionModal(sub, 'REVISI')}
                          style={{
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
                          <CheckCircle2 size={15} /> Setujui (ACC)
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
                        <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 6px' }} />
                        <span style={{ fontSize: '0.8rem' }}>Mengambil rincian produk...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                            Daftar Produk Masuk ({expandedDetail.items.length} jenis)
                          </h4>
                          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 700 }}>
                            Total HPP: Rp{' '}
                            {expandedDetail.items
                              .reduce((sum, it) => sum + Number(it.costPrice) * it.qty, 0)
                              .toLocaleString('id-ID')}
                          </span>
                        </div>

                        {/* Tabel Produk */}
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ background: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ padding: '8px 10px', borderRadius: '6px 0 0 6px' }}>Nama Produk</th>
                                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Qty</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Harga Beli (HPP)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Subtotal</th>
                                <th style={{ padding: '8px 10px' }}>Expired Date</th>
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
                                      {it.productName}
                                    </td>
                                    <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 800, color: '#0284c7' }}>
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
          {/* ── FILTER TABS FEFO & SEARCH BAR ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {[
                { id: 'SUBMITTED', label: 'Menunggu Keputusan', badge: pendingFefoCount > 0 ? pendingFefoCount : null },
                { id: 'APPROVED', label: 'Telah Disetujui / Diskon Aktif' },
                { id: 'semua', label: 'Semua Laporan FEFO' },
              ].map((tab) => {
                const isActive = fefoStatusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFefoStatusFilter(tab.id as typeof fefoStatusFilter)}
                    style={{
                      padding: '9px 16px',
                      borderRadius: 22,
                      fontSize: '0.82rem',
                      fontWeight: isActive ? 800 : 500,
                      border: isActive ? '1.5px solid #ea580c' : '1px solid #cbd5e1',
                      backgroundColor: isActive ? '#ffedd5' : '#ffffff',
                      color: isActive ? '#9a3412' : '#475569',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    <span>{tab.label}</span>
                    {tab.badge !== null && tab.badge !== undefined && (
                      <span
                        style={{
                          backgroundColor: '#ef4444',
                          color: '#ffffff',
                          borderRadius: 10,
                          padding: '1px 7px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
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
              {/* Tombol Export Excel Rekap FEFO */}
              <button
                type="button"
                onClick={handleExportFefoExcel}
                disabled={loadingFefo || exportingFefoExcel || fefoReports.length === 0}
                style={{
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
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Mengekspor...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={15} color="#38bdf8" />
                    <span>Unduh Rekap FEFO (.xlsx)</span>
                  </>
                )}
              </button>

              {/* Search Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '6px 12px', minWidth: 220 }}>
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

          {/* ── DAFTAR LAPORAN FEFO ── */}
          {loadingFefo ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px' }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Memuat laporan kondisi fisik FEFO...</p>
            </div>
          ) : fefoReports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <Flame size={48} color="#cbd5e1" style={{ margin: '0 auto 14px' }} />
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: '#1e293b' }}>
                {fefoStatusFilter === 'SUBMITTED' ? 'Semua Beres! Tidak Ada Antrian Laporan FEFO' : 'Tidak Ada Data Laporan FEFO'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                {fefoStatusFilter === 'SUBMITTED'
                  ? 'Semua laporan pemeriksaan batch kedaluwarsa telah Anda tetapkan keputusannya.'
                  : `Belum ada laporan pada filter "${fefoStatusFilter}".`}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {fefoReports.map((rep) => {
                const normalPrice = Number(rep.sellingPrice);
                const discountPct = Number(rep.approvedDiscountPct || rep.suggestedDiscountPct || 0);
                const discountedPrice = Math.round(normalPrice * (1 - discountPct / 100));

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
                              KEPUTUSAN: {rep.managerDecision}
                            </span>
                            {rep.approvedDiscountPct && (
                              <span style={{ background: '#dc2626', color: '#ffffff', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 900 }}>
                                🏷️ {rep.approvedDiscountPct}% OFF
                              </span>
                            )}
                          </div>
                          {rep.discountBarcode && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#15803d' }}>
                              <Barcode size={16} />
                              <span>Barcode Override: <code style={{ fontWeight: 800, background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>{rep.discountBarcode}</code></span>
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
                            setSelectedFefo(rep);
                            setApprovedDiscountPct(Number(rep.suggestedDiscountPct) || 30);
                            setFefoDecision(rep.gudangSuggestion === 'DISCOUNT' ? 'DISCOUNT' : 'DISCOUNT');
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
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: '0.88rem' }}>Memuat database pemasok...</p>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
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
                            style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}
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
                      onClick={() => handleDeleteSupplier(sup.id, sup.name)}
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
      ) : (
        /* ── KONTEN LAPORAN MUTASI STOK (EXCEL SPREADSHEET HITAM PUTIH CLEAN) ── */
        <LaporanMutasiStokSection />
      )}

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
                  {actionType === 'APPROVE' && 'Setujui Penerimaan Barang (ACC)'}
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
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5, background: '#f8fafc', padding: 14, borderRadius: 10 }}>
                <p style={{ margin: '0 0 8px 0' }}>
                  Dengan menyetujui penerimaan barang ini:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: '#475569' }}>
                  <li>Batch stok baru akan dibuat secara atomik di tabel <code>stock_batches</code>.</li>
                  <li>Kuantitas stok produk di kasir akan <strong>langsung bertambah</strong>.</li>
                  <li>Tindakan Anda akan tercatat permanen di <code>audit_logs</code>.</li>
                </ul>
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
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    {actionType === 'APPROVE' && <CheckCircle2 size={16} />}
                    {actionType === 'APPROVE' ? 'Konfirmasi ACC Sekarang' : actionType === 'REVISI' ? 'Kirim Catatan Revisi' : 'Tolak Pengajuan'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL KEPUTUSAN MANAGER UNTUK FEFO & DISKON ── */}
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
                    Keputusan Penanganan FEFO
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                    Wewenang Manager menetapkan diskon atau write-off.
                  </p>
                </div>
              </div>
              <button
                type="button"
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

            {/* Pilihan Keputusan */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Pilih Keputusan Manager *
              </label>
              <select
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
                <option value="DISCOUNT">🏷️ ACC Diskon Obral Darurat (Auto-Generate Barcode Kasir)</option>
                <option value="DISPLAY_FRONT">➡️ Pindahkan ke Rak Depan Kasir (Jual Normal)</option>
                <option value="DESTROY">🗑️ ACC Pemusnahan / Write-Off (Barang Rusak/Basi)</option>
                <option value="RETURN_SUPPLIER">↩️ ACC Retur ke Supplier</option>
                <option value="HOLD">⏸️ Tahan Sementara (Pantau Kondisi)</option>
              </select>
            </div>

            {/* Jika Keputusan DISCOUNT: Input Persentase & Preview Barcode */}
            {fefoDecision === 'DISCOUNT' && (
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
                    Harga Baru: {formatRupiah(Math.round(Number(selectedFefo.sellingPrice) * (1 - approvedDiscountPct / 100)))}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#7f1d1d', lineHeight: 1.4 }}>
                  * Sistem otomatis membuat stiker barcode override unik (<code>DISC-XXXXXX-XXXX</code>) dan kebijakan diskon kasir.
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
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Konfirmasi Keputusan Manager</span>
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
                      <RefreshCw size={14} className="animate-spin" />
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
    </div>
  );
}
