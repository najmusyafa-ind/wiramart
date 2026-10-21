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
  FileText,
  Search,
  Trash2,
  Calendar,
  Layers,
  ChevronRight,
  Eye,
  Send,
  X,
  AlertCircle,
  Sparkles,
  Edit3,
} from 'lucide-react';

export type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';

export type DraftSummaryItem = {
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

export default function PenerimaanBarangSection({
  productsList,
  onDraftApproved,
}: PenerimaanBarangSectionProps) {
  const modalSearchId = useId();

  // State List Drafts
  const [drafts, setDrafts] = useState<DraftSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('semua');

  // State Modal Detail
  const [viewingDraftId, setViewingDraftId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DraftFullDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // State Form Modal (Input / Edit)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [registeredSuppliers, setRegisteredSuppliers] = useState<
    Array<{ id: string; name: string; contactPerson: string | null; phone: string | null }>
  >([]);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [items, setItems] = useState<DraftItemDetail[]>([]);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // State Picker Produk
  const [productSearch, setProductSearch] = useState('');
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);

  // ── Load List Pemasok Terdaftar ──────────────────────────────
  async function fetchSuppliers() {
    try {
      const res = await fetch('/api/gudang/suppliers');
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setRegisteredSuppliers(json.data);
      }
    } catch {
      // silent
    }
  }

  // ── Load List Drafts ─────────────────────────────────────────
  async function fetchDrafts(filter = statusFilter) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const url =
        filter === 'semua'
          ? '/api/gudang/penerimaan'
          : `/api/gudang/penerimaan?status=${filter.toUpperCase()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal memuat antrian penerimaan barang');
      }
      setDrafts(json.data.items || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan sistem.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDrafts(statusFilter);
    fetchSuppliers();
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

  // ── Tambah Produk ke List ────────────────────────────────────
  function handleSelectProduct(prod: ProductOption) {
    const today = new Date();
    const batchCode = `B${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    setItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        batchCode,
        qty: 1,
        costPrice: 0,
        expiryDate: '',
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

      let draftId = editingDraftId;

      if (editingDraftId) {
        // PATCH update
        const res = await fetch(`/api/gudang/penerimaan/${editingDraftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memperbarui draft');
      } else {
        // POST create
        const res = await fetch('/api/gudang/penerimaan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal membuat draft');
        draftId = json.data.id;
      }

      // Jika user memilih langsung mengajukan ke Manager
      if (shouldSubmitToManager && draftId) {
        const subRes = await fetch(`/api/gudang/penerimaan/${draftId}/submit`, {
          method: 'POST',
        });
        const subJson = await subRes.json();
        if (!subRes.ok || !subJson.success) {
          throw new Error(subJson.error ?? 'Draft tersimpan, tetapi gagal diajukan ke Manager.');
        }
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
            <Truck size={20} color="#0284c7" /> Penerimaan Barang Masuk (2-Layer ACC)
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Input stok dari supplier & minta persetujuan Manager sebelum stok masuk ke kasir.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
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
          <Plus size={16} /> + Input Barang Masuk
        </button>
      </div>

      {/* ── FILTER STATUS TABS ── */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
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
              onClick={() => setStatusFilter(f.id)}
              style={{
                padding: '8px 14px',
                borderRadius: 20,
                fontSize: '0.8rem',
                fontWeight: isActive ? 700 : 500,
                border: isActive ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                backgroundColor: isActive ? '#e0f2fe' : '#ffffff',
                color: isActive ? '#0369a1' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
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
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.75rem',
          }}
          title="Segarkan data"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Segarkan
        </button>
      </div>

      {/* ── LIST DRAFTS / CARDS ── */}
      {loading ? (
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
              padding: '8px 16px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Input Barang Sekarang
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                </div>

                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
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
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
                  <span style={{ color: '#64748b' }}>No. Surat Jalan: </span>
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
                  gap: 8,
                  paddingTop: 4,
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <button
                  type="button"
                  onClick={() => openDetailModal(d.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#334155',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Eye size={13} /> Rincian Item
                </button>

                {(d.status === 'DRAFT' || d.status === 'REVISED') && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditModal(d.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid #38bdf8',
                        background: '#f0f9ff',
                        color: '#0284c7',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Edit3 size={13} /> {d.status === 'REVISED' ? 'Perbaiki Draft' : 'Edit'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDirectSubmit(d.id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#0284c7',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        boxShadow: '0 1px 3px rgba(2, 132, 199, 0.3)',
                      }}
                    >
                      <Send size={13} /> Ajukan ke Manager
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
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
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              padding: '20px 18px',
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
                borderBottom: '1px solid #f1f5f9',
                paddingBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                  Rincian Penerimaan Barang
                </h3>
                {detailData && (
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace' }}>
                    {detailData.receiveNumber}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingDraftId(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
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
                    <span style={{ color: '#64748b' }}>Surat Jalan: </span>
                    <strong>{detailData.deliveryNote || '—'}</strong>
                  </div>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span>{it.productName}</span>
                          <span style={{ color: '#0284c7' }}>{it.qty} unit</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: '#64748b', fontSize: '0.75rem' }}>
                          <span>
                            HPP: <strong>Rp {Number(it.costPrice).toLocaleString('id-ID')}</strong>
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
                    gap: 8,
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setViewingDraftId(null)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: '0.8rem',
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

      {/* ── MODAL FORM (INPUT / EDIT DRAFT) ── */}
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
              maxWidth: 720,
              width: '100%',
              maxHeight: '94vh',
              overflowY: 'auto',
              boxShadow: '0 25px 30px -5px rgba(0, 0, 0, 0.2)',
              padding: '20px 18px',
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
                borderBottom: '1px solid #f1f5f9',
                paddingBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  {editingDraftId ? 'Edit Draft Penerimaan Barang' : 'Form Input Penerimaan Barang Masuk'}
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Stok tidak akan bertambah sebelum Manager memberikan persetujuan (2-Layer ACC).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
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

            {/* Input Informasi Pengiriman */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    Nama Supplier / Distributor
                  </label>
                  {registeredSuppliers.length > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      Pilih dari master atau ketik
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
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
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
                  placeholder="Ketik nama pemasok (misal: PT Indofood / Toko Roti Mandiri)"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>


              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Nomor Surat Jalan / Catatan Kirim
                </label>
                <input
                  type="text"
                  placeholder="Contoh: SJ-2026/X/0091"
                  value={deliveryNote}
                  onChange={(e) => setDeliveryNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Daftar Produk yang Diterima */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e293b' }}>
                  Daftar Produk Masuk ({items.length} item)
                </label>

                <button
                  type="button"
                  onClick={() => setIsProductPickerOpen(true)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #0284c7',
                    background: '#f0f9ff',
                    color: '#0284c7',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Plus size={14} /> + Pilih Produk SKU
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
                    Belum ada produk yang ditambahkan ke draft
                  </p>
                  <p style={{ margin: 0, fontSize: '0.75rem' }}>
                    Klik tombol <strong>+ Pilih Produk SKU</strong> di atas untuk memasukkan barang.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map((it, idx) => {
                    const prodMeta = productsList.find((p) => p.id === it.productId);
                    const isPerishable = prodMeta?.isPerishable;

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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
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
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            style={{
                              background: '#fee2e2',
                              border: 'none',
                              color: '#ef4444',
                              padding: 4,
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                            title="Hapus Item"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: 8,
                          }}
                        >
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>
                              Jumlah Qty (Unit)
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={it.qty}
                              onChange={(e) => handleUpdateItem(idx, 'qty', parseInt(e.target.value || '1', 10))}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: '0.8rem',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>
                              Harga Beli HPP (Rp)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={it.costPrice}
                              onChange={(e) => handleUpdateItem(idx, 'costPrice', parseFloat(e.target.value || '0'))}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: '0.8rem',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>
                              Tanggal Expired {isPerishable && <span style={{ color: '#ef4444' }}>*Wajib</span>}
                            </label>
                            <input
                              type="date"
                              value={it.expiryDate || ''}
                              onChange={(e) => handleUpdateItem(idx, 'expiryDate', e.target.value)}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: isPerishable && !it.expiryDate ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                                fontSize: '0.78rem',
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
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: '0.78rem',
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
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: '1px solid #e2e8f0',
                              fontSize: '0.75rem',
                              boxSizing: 'border-box',
                              background: '#f8fafc',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
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
                disabled={submittingForm || items.length === 0}
                onClick={() => handleSubmitForm(false)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: '1px solid #0284c7',
                  background: '#f0f9ff',
                  color: '#0284c7',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Simpan sebagai Draft
              </button>

              <button
                type="button"
                disabled={submittingForm || items.length === 0}
                onClick={() => handleSubmitForm(true)}
                style={{
                  padding: '9px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                }}
              >
                <Send size={14} /> Simpan & Langsung Ajukan ke Manager
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
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800 }}>Pilih Produk SKU</h4>
              <button
                type="button"
                onClick={() => setIsProductPickerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
              <input
                id={modalSearchId}
                type="text"
                placeholder="Cari nama produk atau barcode..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 34px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {filteredProductOptions.slice(0, 50).map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => handleSelectProduct(prod)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #f1f5f9',
                    background: '#f8fafc',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.1s',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{prod.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {prod.categoryName} • Stok Sekarang: {prod.stockQty} {prod.unit}
                    </div>
                  </div>
                  <ChevronRight size={14} color="#94a3b8" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
