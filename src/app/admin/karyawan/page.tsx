'use client';

import { useState, useEffect, useId, useCallback } from 'react';
import { Plus, Search, UserCheck, UserX, Trash2, Edit2, X, Loader2, Users, AlertTriangle } from 'lucide-react';

type Employee = {
  id: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  isActive: boolean;
  createdAt: string;
};

// ── Modal tambah/edit karyawan ────────────────────────────────
function KaryawanModal({
  onClose,
  onSuccess,
  editData,
}: {
  onClose: () => void;
  onSuccess: () => void;
  editData?: Employee | null;
}) {
  const uid = useId();
  const isEdit = !!editData;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    fullName: editData?.fullName ?? '',
    nim: editData?.nim ?? '',
    programStudi: editData?.programStudi ?? '',
    jabatan: editData?.jabatan ?? 'Kasir',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        isEdit ? `/api/admin/karyawan/${editData!.id}` : '/api/admin/karyawan',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan data');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('Terjadi kesalahan jaringan');
    } finally {
      setLoading(false);
    }
  }

  const prodiOptions = [
    'Manajemen', 'Akuntansi', 'Sistem Informasi', 'Teknik Informatika',
    'Ilmu Hukum', 'Administrasi Publik', 'Pendidikan Ekonomi', 'Lainnya',
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)',
        animation: 'fade-in 0.2s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 480, margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h2 id={`${uid}-title`} className="card-title" style={{ fontSize: 'var(--text-base)' }}>
            {isEdit ? 'Edit Karyawan' : 'Tambah Karyawan Baru'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup modal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
          >
            <X size={20} />
          </button>
        </div>
        <div className="card-body">
          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor={`${uid}-name`} className="form-label">Nama Lengkap *</label>
              <input
                id={`${uid}-name`}
                type="text"
                className="form-input"
                placeholder="Nama sesuai KTM"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                required
                disabled={loading}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor={`${uid}-nim`} className="form-label">NIM *</label>
                <input
                  id={`${uid}-nim`}
                  type="text"
                  className="form-input"
                  placeholder="Contoh: 2024001234"
                  value={form.nim}
                  onChange={(e) => setForm((f) => ({ ...f, nim: e.target.value }))}
                  required
                  disabled={loading || isEdit}
                />
              </div>
              <div className="form-group">
                <label htmlFor={`${uid}-jabatan`} className="form-label">Jabatan</label>
                <input
                  id={`${uid}-jabatan`}
                  type="text"
                  className="form-input"
                  placeholder="Kasir"
                  value={form.jabatan}
                  onChange={(e) => setForm((f) => ({ ...f, jabatan: e.target.value }))}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${uid}-prodi`} className="form-label">Program Studi *</label>
              <select
                id={`${uid}-prodi`}
                className="form-input form-select"
                value={form.programStudi}
                onChange={(e) => setForm((f) => ({ ...f, programStudi: e.target.value }))}
                required
                disabled={loading || isEdit}
              >
                <option value="">— Pilih Program Studi —</option>
                {prodiOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', paddingTop: 'var(--space-2)' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading} id={`${uid}-submit`}>
                {loading ? <><Loader2 size={14} className="animate-spin" /> Menyimpan...</> : (isEdit ? 'Simpan Perubahan' : 'Tambah Karyawan')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Halaman utama manajemen karyawan ─────────────────────────
export default function KaryawanPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState<Employee | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const uid = useId();

  const fetchEmployees = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/karyawan?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (res.ok) setEmployees(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // FIXED: satu useEffect debounced menggantikan double fetch
  useEffect(() => {
    const t = setTimeout(() => fetchEmployees(search), 350);
    return () => clearTimeout(t);
  }, [search, fetchEmployees]);

  async function handleToggleActive(emp: Employee) {
    await fetch(`/api/admin/karyawan/${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !emp.isActive }),
    });
    fetchEmployees(search);
  }

  // FIXED: ganti confirm() dengan state-based dialog
  function handleDelete(id: string, name: string) {
    setConfirmDelete({ id, name });
  }

  async function executeDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/karyawan/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setDeleteError(json.error ?? 'Gagal menghapus karyawan.');
        return;
      }
      fetchEmployees(search);
    } catch {
      setDeleteError('Gagal menghapus karyawan. Periksa koneksi.');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <>
      {/* ── Confirm Delete Dialog ──────────────────────────── */}
      {confirmDelete && (
        <div
          role="alertdialog" aria-modal="true"
          aria-labelledby="confirm-del-karyawan-title"
          aria-describedby="confirm-del-karyawan-desc"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-backdrop-blur)',
            backdropFilter: 'blur(8px)',
            animation: 'fade-in 0.15s ease',
          }}
        >
          <div className="card" style={{ maxWidth: 400, width: '100%', boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-6)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <AlertTriangle size={22} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <div>
                  <p id="confirm-del-karyawan-title" style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>
                    Hapus Karyawan?
                  </p>
                  <p id="confirm-del-karyawan-desc" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    Karyawan <strong>&ldquo;{confirmDelete.name}&rdquo;</strong> akan dihapus.
                    Data shift &amp; transaksi tetap tersimpan.
                  </p>
                </div>
              </div>
              {deleteError && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', background: 'var(--color-error-light)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
                  {deleteError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setConfirmDelete(null); setDeleteError(null); }}
                  className="btn btn-secondary" disabled={!!deletingId} autoFocus
                >
                  Batal
                </button>
                <button
                  onClick={() => executeDelete(confirmDelete.id)}
                  className="btn btn-danger" disabled={!!deletingId}
                >
                  {deletingId ? <><Loader2 size={14} className="spin-icon" aria-hidden="true" /> Menghapus...</> : 'Ya, Hapus'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Manajemen Karyawan</h1>
          <p className="page-subtitle">{employees.length} karyawan terdaftar</p>
        </div>
        <button
          id="btn-tambah-karyawan"
          onClick={() => { setEditData(null); setShowModal(true); }}
          className="btn btn-primary"
        >
          <Plus size={16} aria-hidden="true" />
          Tambah Karyawan
        </button>
      </div>

      {/* Search bar */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <div className="form-input-icon" style={{ maxWidth: 400 }}>
            <Search size={16} className="form-input-icon__icon" aria-hidden="true" />
            <input
              id={`${uid}-search`}
              type="search"
              className="form-input form-input-icon__input"
              placeholder="Cari nama, NIM, atau prodi..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Cari karyawan"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <Loader2 size={32} style={{ margin: '0 auto', animation: 'spin 1s linear infinite' }} />
            <p className="text-sm" style={{ marginTop: 'var(--space-3)' }}>Memuat data...</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <Users size={40} style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }} />
            <p className="text-sm">
              {search ? `Tidak ada hasil untuk "${search}"` : 'Belum ada karyawan. Tambah karyawan pertama!'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
            <table className="table" aria-label="Daftar karyawan">
              <thead>
                <tr>
                  <th scope="col">Nama Lengkap</th>
                  <th scope="col">NIM</th>
                  <th scope="col">Program Studi</th>
                  <th scope="col">Jabatan</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 'var(--weight-medium)' }}>{emp.fullName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{emp.nim}</td>
                    <td>{emp.programStudi}</td>
                    <td>{emp.jabatan}</td>
                    <td>
                      <span className={`badge ${emp.isActive ? 'badge-success' : 'badge-error'}`}>
                        {emp.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                        {/* Toggle aktif */}
                        <button
                          onClick={() => handleToggleActive(emp)}
                          className="btn btn-ghost btn-sm"
                          title={emp.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                          aria-label={`${emp.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${emp.fullName}`}
                          style={{ color: emp.isActive ? 'var(--color-warning)' : 'var(--color-success)' }}
                        >
                          {emp.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => { setEditData(emp); setShowModal(true); }}
                          className="btn btn-ghost btn-sm"
                          title="Edit karyawan"
                          aria-label={`Edit ${emp.fullName}`}
                        >
                          <Edit2 size={15} />
                        </button>
                        {/* Hapus */}
                        <button
                          onClick={() => handleDelete(emp.id, emp.fullName)}
                          className="btn btn-ghost btn-sm"
                          title="Hapus karyawan"
                          aria-label={`Hapus ${emp.fullName}`}
                          disabled={deletingId === emp.id}
                          style={{ color: 'var(--color-error)' }}
                        >
                          {deletingId === emp.id ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <KaryawanModal
          editData={editData}
          onClose={() => setShowModal(false)}
          onSuccess={() => fetchEmployees(search)}
        />
      )}
    </div>
    </>
  );
}
