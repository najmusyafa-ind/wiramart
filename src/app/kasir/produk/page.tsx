'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Edit2, Package, X, Loader2, ChevronLeft,
  Camera, CheckCircle, AlertCircle,
} from 'lucide-react';

type Category = { id: string; name: string };
type Product = {
  id: string; name: string; description?: string;
  costPrice: string; sellingPrice: string; stockQty: number;
  unit: string; photoUrl?: string; isActive: boolean;
  categoryId: string; categoryName?: string;
};

// ────────────────────────────────────────────────
// Komponen Toast notifikasi ringan
// ────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
      background: type === 'success' ? 'hsl(142 60% 38%)' : 'hsl(0 72% 51%)',
      color: '#fff', padding: '10px 20px', borderRadius: 12,
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 9999,
      fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

// ────────────────────────────────────────────────
// Modal Tambah / Edit Produk
// ────────────────────────────────────────────────
function ProdukModal({
  categories, editData, onClose, onSaved,
}: {
  categories: Category[];
  editData: Product | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isEdit = !!editData;
  const [form, setForm] = useState({
    categoryId: editData?.categoryId ?? (categories[0]?.id ?? ''),
    name: editData?.name ?? '',
    description: editData?.description ?? '',
    sellingPrice: editData ? Number(editData.sellingPrice) : 0,
    costPrice: editData ? Number(editData.costPrice) : 0,
    stockQty: editData?.stockQty ?? 0,
    unit: editData?.unit ?? 'pcs',
  });
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(editData?.photoUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFoto(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) { setErr('Nama produk wajib diisi.'); return; }
    if (!form.categoryId) { setErr('Pilih kategori.'); return; }
    if (form.sellingPrice <= 0) { setErr('Harga jual harus lebih dari 0.'); return; }
    setSaving(true);
    try {
      // 1. Create / Update produk
      let productId = editData?.id ?? '';
      if (!isEdit) {
        const res = await fetch('/api/admin/produk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) { setErr(json.error ?? 'Gagal menyimpan produk.'); setSaving(false); return; }
        productId = json.data.id;
      } else {
        const res = await fetch(`/api/admin/produk/${editData!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) { setErr(json.error ?? 'Gagal mengupdate produk.'); setSaving(false); return; }
      }

      // 2. Upload foto jika ada
      if (foto && productId) {
        const fd = new FormData();
        fd.append('foto', foto);
        await fetch(`/api/admin/produk/${productId}/foto`, { method: 'POST', body: fd });
      }

      onSaved(isEdit ? 'Produk berhasil diperbarui!' : 'Produk berhasil ditambahkan!');
    } catch {
      setErr('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  const f = form;
  const set = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--color-surface)', width: '100%', maxWidth: 520,
        borderRadius: '20px 20px 0 0', padding: 'var(--space-6)',
        maxHeight: '90dvh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)' }}>
            {isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {err && (
          <div style={{ background: 'var(--color-error-light)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            {err}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Foto */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Foto Produk</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 80, height: 80, borderRadius: 10,
                background: 'var(--color-surface-muted)', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1.5px dashed var(--color-border)',
              }}>
                {preview
                  ? <img src={preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Package size={28} color="var(--color-text-muted)" />}
              </div>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                fontSize: 'var(--text-sm)', fontWeight: 600,
              }}>
                <Camera size={15} />
                {preview ? 'Ganti Foto' : 'Pilih Foto'}
                <input type="file" accept="image/*" onChange={handleFoto} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Auto-kompres WebP</span>
            </div>
          </div>

          {/* Kategori */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Kategori *</label>
            <select
              value={f.categoryId} onChange={e => set('categoryId', e.target.value)}
              className="form-input" required
            >
              <option value="">-- Pilih Kategori --</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Nama */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Nama Produk *</label>
            <input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Contoh: Aqua Botol 600ml" required />
          </div>

          {/* Deskripsi */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Deskripsi (opsional)</label>
            <textarea className="form-input" value={f.description} onChange={e => set('description', e.target.value)} placeholder="Deskripsi singkat produk..." rows={2} style={{ resize: 'none' }} />
          </div>

          {/* Harga beli & jual */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Harga Beli (Rp)</label>
              <input className="form-input" type="number" min={0} value={f.costPrice} onChange={e => set('costPrice', Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Harga Jual (Rp) *</label>
              <input className="form-input" type="number" min={1} value={f.sellingPrice} onChange={e => set('sellingPrice', Number(e.target.value))} placeholder="0" required />
            </div>
          </div>

          {/* Stok & Satuan */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Stok Awal</label>
              <input className="form-input" type="number" min={0} value={f.stockQty} onChange={e => set('stockQty', Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Satuan</label>
              <select className="form-input" value={f.unit} onChange={e => set('unit', e.target.value)}>
                <option value="pcs">pcs</option>
                <option value="kg">kg</option>
                <option value="liter">liter</option>
                <option value="botol">botol</option>
                <option value="pak">pak</option>
                <option value="dus">dus</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 8 }}>
            {saving ? <><Loader2 size={15} className="spin-icon" /> Menyimpan...</> : (isEdit ? 'Simpan Perubahan' : '+ Tambah Produk')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Halaman utama Kelola Produk (Kasir)
// ────────────────────────────────────────────────
export default function KasirProdukPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState<Product | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchProducts = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/produk?q=${encodeURIComponent(q)}`);
      if (res.status === 401 || res.status === 403) { router.push('/kasir/login'); return; }
      const json = await res.json();
      if (json.success) {
        setProducts(json.data.products);
        setCategories(json.data.categories);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const t = setTimeout(() => fetchProducts(search), 350);
    return () => clearTimeout(t);
  }, [search, fetchProducts]);

  function onSaved(msg: string) {
    setShowModal(false);
    setEditData(null);
    setToast({ msg, type: 'success' });
    fetchProducts(search);
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 24 }}>
      {/* Header */}
      <div style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: 'var(--shadow-xs)',
      }}>
        <button
          onClick={() => router.push('/kasir/pos')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-secondary)', padding: 4 }}
          aria-label="Kembali ke POS"
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', lineHeight: 1.2 }}>Kelola Produk</h1>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{products.length} produk tersedia</p>
        </div>
        <button
          onClick={() => { setEditData(null); setShowModal(true); }}
          className="btn btn-primary btn-sm"
          id="btn-tambah-produk-kasir"
        >
          <Plus size={15} /> Tambah
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '12px 16px' }}>
        <div className="form-input-icon">
          <Search size={16} className="form-input-icon__icon" />
          <input
            className="form-input form-input-icon__input"
            type="search"
            placeholder="Cari nama produk..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Cari produk"
          />
        </div>
      </div>

      {/* Produk List */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div className="empty-state" style={{ padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <Loader2 size={24} className="spin-icon" />
            <span style={{ fontSize: 14 }}>Memuat produk...</span>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <Package size={36} />
            <span style={{ fontSize: 14 }}>{search ? `Tidak ada hasil untuk "${search}"` : 'Belum ada produk.'}</span>
          </div>
        ) : (
          products.map(p => (
            <div key={p.id} style={{
              background: 'var(--color-surface)', borderRadius: 12,
              border: '1px solid var(--color-border)',
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              {/* Foto */}
              <div style={{
                width: 52, height: 52, borderRadius: 8, flexShrink: 0,
                background: 'var(--color-surface-muted)', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {p.photoUrl
                  ? <img src={p.photoUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Package size={22} color="var(--color-text-muted)" />}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{p.categoryName ?? '—'} · Stok: {p.stockQty} {p.unit}</div>
                <div style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 700 }}>
                  Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                </div>
              </div>
              {/* Edit */}
              <button
                onClick={() => { setEditData(p); setShowModal(true); }}
                className="btn btn-ghost btn-sm"
                title="Edit produk"
                aria-label={`Edit ${p.name}`}
              >
                <Edit2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ProdukModal
          categories={categories}
          editData={editData}
          onClose={() => { setShowModal(false); setEditData(null); }}
          onSaved={onSaved}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
