'use client';

import { useState, useEffect, useId, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  UserCheck,
  UserX,
  Trash2,
  Edit2,
  X,
  Loader2,
  Users,
  AlertTriangle,
  LogOut,
  CheckCircle,
  Crown,
  Package,
  ShoppingBag,
  Briefcase,
  User,
  Filter,
  ShieldCheck,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAdmin } from '../AdminLayoutClient';

type Employee = {
  id: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  isActive: boolean;
  isKetuaShift: boolean;
  hasPin: boolean;
  createdAt: string;
  // Dari left join shiftSchedules
  shiftDay:    string | null;
  shiftStart:  string | null;
  shiftEnd:    string | null;
  shiftSlotId: string | null;
  // Dari left join shifts (sesi kasir aktif)
  activeShiftId:      string | null;
  activeShiftClockIn: string | null;
  // Kumpulan seluruh shift yang diassign ke karyawan
  allShifts?: { day: string; start: string; end: string; slotId: string }[];
};

// Tipe slot dari publik jadwal endpoint
type SlotOption = {
  slotId:     string;
  dayOfWeek:  string;
  slotStart:  string;
  slotEnd:    string;
  isFilled:   boolean;
  employeeId: string | null;
  employeeName: string | null;
};

const JABATAN_OPTIONS = [
  { value: 'Kasir', label: 'Kasir', desc: 'Melayani transaksi penjualan di meja POS kasir' },
  { value: 'Gudang', label: 'Gudang', desc: 'Staf inventaris toko, penerimaan stok, dan cek expired FEFO' },
  { value: 'CS Pelayan', label: 'CS Pelayan (Customer Service & Pramuniaga)', desc: 'Layanan pelanggan toko, display etalase, dan cek makanan basi' },
  { value: 'Admin Shift', label: 'Admin Shift (Ketua Shift)', desc: 'Koordinator operasional shift toko, pemegang PIN otorisasi, dan serah terima shift' },
];

const PRODI_OPTIONS: { fakultas: string; prodi: string[] }[] = [
  {
    fakultas: 'FEB — Fakultas Ekonomi & Bisnis',
    prodi: ['Akuntansi', 'Manajemen'],
  },
  {
    fakultas: 'FST — Fakultas Sains & Teknologi',
    prodi: ['Teknik Informatika', 'Agribisnis', 'Teknik Mesin'],
  },
];

// ── Modal tambah / edit karyawan ──────────────────────────────
function KaryawanModal({
  onClose,
  onSuccess,
  editData,
  initialFocusPin = false,
}: {
  onClose: () => void;
  onSuccess: () => void;
  editData?: Employee | null;
  initialFocusPin?: boolean;
}) {
  const uid = useId();
  const isEdit = !!editData;
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [slotAssignError, setSlotAssignError] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [deletePin, setDeletePin] = useState(false);
  const [form, setForm] = useState({
    fullName: editData?.fullName ?? '',
    nim: editData?.nim ?? '',
    programStudi: editData?.programStudi ?? '',
    jabatan: editData?.jabatan ?? 'Kasir',
    isActive: editData?.isActive ?? true,
  });

  useEffect(() => {
    if (initialFocusPin) {
      const t = setTimeout(() => {
        pinInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(t);
    }
  }, [initialFocusPin]);

  // Slot picker — aktif untuk Tambah MAUPUN Edit
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState(editData?.shiftSlotId ?? '');

  useEffect(() => {
    fetch('/api/publik/jadwal-slot')
      .then((r) => r.json())
      .then((j) => {
        type RawEntry = { id: string; employeeId: string | null; employeeName: string | null; isFilled: boolean };
        type RawSlot  = { slotStart: string; slotEnd: string; entries: RawEntry[] };
        type RawDay   = { dayOfWeek: string; slots: RawSlot[] };
        const schedule: RawDay[] = j.data?.schedule ?? [];
        const flat: SlotOption[] = [];
        for (const day of schedule) {
          for (const slot of day.slots) {
            for (const entry of slot.entries) {
              flat.push({
                slotId:      entry.id,
                dayOfWeek:   day.dayOfWeek,
                slotStart:   slot.slotStart,
                slotEnd:     slot.slotEnd,
                isFilled:    entry.isFilled,
                employeeId:  entry.employeeId,
                employeeName: entry.employeeName,
              });
            }
          }
        }
        setSlots(flat);
      })
      .catch(() => {})
      .finally(() => setSlotsLoading(false));
  }, []);

  // Group slot per hari+waktu
  type SlotGroup = { key: string; dayOfWeek: string; slotStart: string; slotEnd: string; entries: SlotOption[] };
  const slotGroups: SlotGroup[] = [];
  const seenKeys = new Set<string>();
  const dayOrder = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'];
  for (const day of dayOrder) {
    const daySlotsRaw = slots.filter((s) => s.dayOfWeek === day);
    const timeKeys = Array.from(new Set(daySlotsRaw.map((s) => `${s.slotStart}-${s.slotEnd}`)));
    for (const tk of timeKeys) {
      const key = `${day}|${tk}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const [st, en] = tk.split('-');
        slotGroups.push({
          key,
          dayOfWeek: day,
          slotStart: st ?? '',
          slotEnd:   en ?? '',
          entries:   daySlotsRaw.filter((s) => `${s.slotStart}-${s.slotEnd}` === tk),
        });
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSlotAssignError('');

    try {
      const trimmedPin = pin.trim();
      if (trimmedPin) {
        if (!/^\d{6,8}$/.test(trimmedPin)) {
          setError('PIN harus berupa 6 hingga 8 digit angka murni.');
          setLoading(false);
          return;
        }
      } else if (!isEdit && form.jabatan === 'Admin Shift') {
        setError('Karyawan dengan jabatan Admin Shift wajib diberikan PIN login 6–8 digit.');
        setLoading(false);
        return;
      }

      // Otomatis tandai isKetuaShift jika jabatannya adalah Admin Shift atau jika PIN diset
      const isKetuaShiftCalc =
        form.jabatan === 'Admin Shift' || (deletePin ? false : !!trimmedPin || !!editData?.isKetuaShift);

      const payload: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        nim: form.nim.trim().toUpperCase(),
        programStudi: form.programStudi,
        jabatan: form.jabatan,
        isActive: form.isActive,
        isKetuaShift: isKetuaShiftCalc,
      };

      if (deletePin) {
        payload.deletePin = true;
      } else if (trimmedPin) {
        payload.pin = trimmedPin;
      }

      const res = await fetch(
        isEdit ? `/api/admin/karyawan/${editData!.id}` : '/api/admin/karyawan',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan data karyawan.');
        setLoading(false);
        return;
      }

      const targetEmpId = isEdit ? editData!.id : json.data?.id;

      // Kelola assignment slot jika ada perubahan jadwal
      const originalSlotId = editData?.shiftSlotId ?? '';
      if (targetEmpId && selectedSlotId !== originalSlotId) {
        // Jika sebelumnya punya slot dan sekarang diganti/dikosongkan, bebaskan slot lama
        if (originalSlotId) {
          await fetch(`/api/admin/jadwal/slot/${originalSlotId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'free' }),
          }).catch(() => {});
        }

        // Jika memilih slot baru, assign ke karyawan
        if (selectedSlotId) {
          const slotRes = await fetch(`/api/admin/jadwal/slot/${selectedSlotId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reassign', newEmployeeId: targetEmpId }),
          });

          if (!slotRes.ok) {
            const slotJson = (await slotRes.json()) as { error?: string };
            setSlotAssignError(
              'Data karyawan tersimpan, tetapi perubahan slot jadwal gagal: ' +
                (slotJson.error ?? 'Slot mungkin baru saja terisi orang lain.'),
            );
            setLoading(false);
            onSuccess();
            return;
          }
        }
      }

      onSuccess();
      onClose();
    } catch {
      setError('Terjadi gangguan jaringan saat menyimpan data.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(6px)',
        animation: 'fade-in 0.15s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 500, margin: 0, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 id={`${uid}-title`} className="card-title" style={{ fontSize: 'var(--text-base)', marginBottom: 2 }}>
              {isEdit ? 'Edit Karyawan' : 'Tambah Karyawan Baru'}
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {isEdit ? `Mengubah data ${editData?.fullName}` : 'Daftarkan mahasiswa yang bertugas di Wiramart'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup modal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}
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
          {slotAssignError && (
            <div
              className="alert"
              role="alert"
              style={{
                marginBottom: 'var(--space-4)',
                background: 'hsl(38 95% 92%)',
                border: '1px solid hsl(38 90% 75%)',
                color: 'hsl(38 90% 30%)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                fontSize: 'var(--text-sm)',
              }}
            >
              ⚠️ {slotAssignError}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Nama Lengkap */}
            <div className="form-group">
              <label htmlFor={`${uid}-name`} className="form-label">
                Nama Lengkap *
              </label>
              <input
                id={`${uid}-name`}
                type="text"
                className="form-input"
                placeholder="Nama lengkap sesuai KTM"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                required
                disabled={loading}
              />
            </div>

            {/* NIM & Program Studi */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor={`${uid}-nim`} className="form-label">
                  NIM *
                </label>
                <input
                  id={`${uid}-nim`}
                  type="text"
                  className="form-input"
                  placeholder="Contoh: 2024001234"
                  value={form.nim}
                  onChange={(e) => setForm((f) => ({ ...f, nim: e.target.value }))}
                  required
                  disabled={loading || isEdit}
                  style={isEdit ? { backgroundColor: 'var(--color-surface-muted)', cursor: 'not-allowed' } : undefined}
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${uid}-status`} className="form-label">
                  Status Akun
                </label>
                <select
                  id={`${uid}-status`}
                  className="form-input form-select"
                  value={form.isActive ? 'aktif' : 'nonaktif'}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'aktif' }))}
                  disabled={loading}
                >
                  <option value="aktif">Aktif Bertugas</option>
                  <option value="nonaktif">Nonaktif / Cuti</option>
                </select>
              </div>
            </div>

            {/* Program Studi */}
            <div className="form-group">
              <label htmlFor={`${uid}-prodi`} className="form-label">
                Program Studi *
              </label>
              <select
                id={`${uid}-prodi`}
                className="form-input form-select"
                value={form.programStudi}
                onChange={(e) => setForm((f) => ({ ...f, programStudi: e.target.value }))}
                required
                disabled={loading}
              >
                <option value="">— Pilih Program Studi —</option>
                {PRODI_OPTIONS.map((group) => (
                  <optgroup key={group.fakultas} label={group.fakultas}>
                    {group.prodi.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Jabatan Resmi Toko (4 Peran) */}
            <div className="form-group">
              <label htmlFor={`${uid}-jabatan`} className="form-label">
                Jabatan / Tugas Toko *
              </label>
              <select
                id={`${uid}-jabatan`}
                className="form-input form-select"
                value={form.jabatan}
                onChange={(e) => setForm((f) => ({ ...f, jabatan: e.target.value }))}
                required
                disabled={loading}
              >
                {JABATAN_OPTIONS.map((j) => (
                  <option key={j.value} value={j.value}>
                    {j.label}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                ℹ️ {JABATAN_OPTIONS.find((j) => j.value === form.jabatan)?.desc}
              </p>
            </div>

            {/* Jadwal Shift (Bisa dipilih saat Tambah MAUPUN Edit) */}
            <div className="form-group">
              <label htmlFor={`${uid}-slot`} className="form-label">
                Jadwal Shift Mingguan
                <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                  (Bisa diatur atau diubah kapan saja)
                </span>
              </label>
              {slotsLoading ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={13} className="animate-spin" /> Memuat slot jadwal...
                </div>
              ) : (
                <select
                  id={`${uid}-slot`}
                  className="form-input form-select"
                  value={selectedSlotId}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                  disabled={loading}
                >
                  <option value="">-- Belum ada jadwal shift tetap --</option>
                  {slotGroups.map((g) => {
                    // Tampilkan slot kosong, atau slot yang sedang ditempati oleh karyawan yang sedang diedit
                    const eligibleEntries = g.entries.filter(
                      (e) => !e.isFilled || (isEdit && e.employeeId === editData?.id),
                    );
                    if (eligibleEntries.length === 0) return null;

                    return (
                      <optgroup key={g.key} label={`${g.dayOfWeek} (${g.slotStart}-${g.slotEnd})`}>
                        {eligibleEntries.map((e) => (
                          <option key={e.slotId} value={e.slotId}>
                            Slot #{e.slotId.slice(-4)} {e.employeeId === editData?.id ? '(Slot saat ini)' : '(Tersedia)'}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              )}
            </div>

            {/* ── Kelola PIN Otorisasi Shift & Admin ── */}
            <div
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'hsl(215 25% 98%)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={15} color="var(--color-primary)" />
                  <label htmlFor={`${uid}-pin`} className="form-label" style={{ marginBottom: 0, fontWeight: 700 }}>
                    PIN Otorisasi Shift (6–8 Digit)
                  </label>
                </div>

                {isEdit && (
                  <div>
                    {deletePin ? (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: 'hsl(0 75% 93%)',
                          color: 'hsl(0 70% 35%)',
                          border: '1px solid hsl(0 75% 80%)',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontWeight: 700,
                        }}
                      >
                        Akan Dihapus
                      </span>
                    ) : editData?.hasPin ? (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: 'hsl(142 60% 92%)',
                          color: 'hsl(142 60% 28%)',
                          border: '1px solid hsl(142 60% 75%)',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontWeight: 700,
                        }}
                      >
                        🔑 PIN Terpasang
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: 'hsl(38 95% 92%)',
                          color: 'hsl(38 90% 30%)',
                          border: '1px solid hsl(38 90% 75%)',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontWeight: 700,
                        }}
                      >
                        ⚠️ Belum Ada PIN
                      </span>
                    )}
                  </div>
                )}
              </div>

              {deletePin ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'hsl(0 75% 96%)',
                    border: '1px dashed hsl(0 70% 75%)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <span style={{ fontSize: '0.78rem', color: 'hsl(0 70% 35%)', fontWeight: 600 }}>
                    🗑️ PIN karyawan ini akan dicabut saat disimpan.
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeletePin(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Batalkan
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input
                        ref={pinInputRef}
                        id={`${uid}-pin`}
                        type={showPin ? 'text' : 'password'}
                        className="form-input"
                        placeholder={
                          isEdit && editData?.hasPin
                            ? 'Ketik di sini jika ingin mengganti PIN...'
                            : 'Ketik 6–8 digit angka baru...'
                        }
                        value={pin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                          setPin(val);
                        }}
                        maxLength={8}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={loading}
                        style={{
                          fontFamily: pin ? 'var(--font-mono)' : 'inherit',
                          letterSpacing: pin && !showPin ? '0.25em' : 'normal',
                          paddingRight: 40,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        aria-label={showPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--color-text-muted)',
                          padding: 4,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    {isEdit && editData?.hasPin && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeletePin(true);
                          setPin('');
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid hsl(0 75% 80%)',
                          background: 'hsl(0 75% 96%)',
                          color: 'hsl(0 70% 35%)',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                        title="Hapus / cabut PIN dari karyawan ini"
                      >
                        <Trash2 size={13} />
                        Hapus PIN
                      </button>
                    )}
                  </div>

                  <p style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', margin: 0 }}>
                    {form.jabatan === 'Admin Shift'
                      ? '⚠️ Admin Shift wajib memiliki PIN 6–8 digit angka untuk login ke Dashboard Manajemen.'
                      : 'ℹ️ Digunakan untuk otorisasi shift kasir dan void. Biarkan kosong jika tidak ingin mengubah.'}
                  </p>
                </>
              )}
            </div>

            {/* Tombol Aksi */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', paddingTop: 'var(--space-2)' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading} id={`${uid}-submit`}>
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Menyimpan...
                  </>
                ) : isEdit ? (
                  'Simpan Perubahan'
                ) : (
                  'Tambah Karyawan'
                )}
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
  const { isManager } = useAdmin();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeRoleFilter, setActiveRoleFilter] = useState<string>('Semua');
  const [showModal, setShowModal] = useState(false);
  const [focusPin, setFocusPin] = useState(false);
  const [editData, setEditData] = useState<Employee | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetToast, setResetToast] = useState<{ msg: string; ok: boolean } | null>(null);
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

  useEffect(() => {
    const t = setTimeout(() => fetchEmployees(search), 300);
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

  function handleDelete(id: string, name: string) {
    setConfirmDelete({ id, name });
  }

  async function executeDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/karyawan/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setDeleteError(json.error ?? 'Gagal menghapus data karyawan.');
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

  async function handleResetSesi(emp: Employee) {
    if (!emp.activeShiftId) return;
    setResettingId(emp.id);
    try {
      const res = await fetch(`/api/admin/karyawan/${emp.id}/reset-sesi`, { method: 'POST' });
      const json = (await res.json()) as { data?: { message: string }; error?: string };
      if (res.ok) {
        setResetToast({ msg: json.data?.message ?? 'Sesi berhasil direset.', ok: true });
        fetchEmployees(search);
      } else {
        setResetToast({ msg: json.error ?? 'Gagal mereset sesi.', ok: false });
      }
    } catch {
      setResetToast({ msg: 'Gagal mereset sesi. Periksa koneksi.', ok: false });
    } finally {
      setResettingId(null);
      setTimeout(() => setResetToast(null), 3500);
    }
  }

  // Filter daftar karyawan berdasarkan role filter pills
  const filteredEmployees = employees.filter((emp) => {
    if (activeRoleFilter === 'Semua') return true;
    const jab = emp.jabatan.toLowerCase();
    if (activeRoleFilter === 'Kasir') return jab === 'kasir';
    if (activeRoleFilter === 'Gudang') return jab.includes('gudang');
    if (activeRoleFilter === 'CS Pelayan') return jab.includes('pelayan') || jab.includes('customer service') || jab.includes('cs');
    if (activeRoleFilter === 'Admin Shift') return jab.includes('admin') || jab.includes('ketua') || jab.includes('kepala kasir');
    return true;
  });

  // Helper untuk rendering badge jabatan yang elegan & semantik (4 Peran Resmi)
  function renderJabatanBadge(jabatan: string) {
    const j = (jabatan || '').toLowerCase();
    if (j.includes('admin') || j.includes('ketua') || j.includes('kepala kasir')) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'hsl(38 95% 50% / 0.15)',
            color: 'hsl(38 90% 30%)',
            border: '1px solid hsl(38 95% 50% / 0.35)',
            padding: '3px 9px',
            borderRadius: 6,
            fontSize: '0.74rem',
            fontWeight: 700,
          }}
        >
          <Crown size={12} color="#ca8a04" /> Admin Shift
        </span>
      );
    }
    if (j.includes('gudang')) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'hsl(200 85% 48% / 0.12)',
            color: 'hsl(200 85% 30%)',
            border: '1px solid hsl(200 85% 48% / 0.25)',
            padding: '3px 9px',
            borderRadius: 6,
            fontSize: '0.74rem',
            fontWeight: 600,
          }}
        >
          <Package size={12} /> Gudang
        </span>
      );
    }
    if (j.includes('pelayan') || j.includes('cs') || j.includes('customer')) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'hsl(240 60% 55% / 0.12)',
            color: 'hsl(240 60% 38%)',
            border: '1px solid hsl(240 60% 55% / 0.25)',
            padding: '3px 9px',
            borderRadius: 6,
            fontSize: '0.74rem',
            fontWeight: 600,
          }}
        >
          <User size={12} /> CS Pelayan
        </span>
      );
    }
    // Default: Kasir
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'hsl(150 70% 40% / 0.12)',
          color: 'hsl(150 70% 28%)',
          border: '1px solid hsl(150 70% 40% / 0.25)',
          padding: '3px 9px',
          borderRadius: 6,
          fontSize: '0.74rem',
          fontWeight: 600,
        }}
      >
        <ShoppingBag size={12} /> Kasir
      </span>
    );
  }

  return (
    <>
      {/* ── Toast Notifikasi ────────────────────────────────────── */}
      {resetToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: resetToast.ok ? 'hsl(142 60% 38%)' : 'hsl(0 72% 51%)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            fontSize: 14,
            fontWeight: 600,
            animation: 'fade-in 0.2s ease',
          }}
        >
          {resetToast.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {resetToast.msg}
        </div>
      )}

      {/* ── Confirm Delete Dialog ──────────────────────────── */}
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-del-karyawan-title"
          aria-describedby="confirm-del-karyawan-desc"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-backdrop-blur)',
            backdropFilter: 'blur(8px)',
            animation: 'fade-in 0.15s ease',
          }}
        >
          <div className="card" style={{ maxWidth: 400, width: '100%', boxShadow: 'var(--shadow-xl)' }}>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-6)' }}
            >
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <AlertTriangle
                  size={22}
                  style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }}
                  aria-hidden="true"
                />
                <div>
                  <p id="confirm-del-karyawan-title" style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>
                    Hapus Data Karyawan?
                  </p>
                  <p id="confirm-del-karyawan-desc" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    Karyawan <strong>&ldquo;{confirmDelete.name}&rdquo;</strong> akan dinonaktifkan dari sistem. Data transaksi &amp; shift
                    lama tetap aman tersimpan di riwayat.
                  </p>
                </div>
              </div>
              {deleteError && (
                <p
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-error)',
                    background: 'var(--color-error-light)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {deleteError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setConfirmDelete(null);
                    setDeleteError(null);
                  }}
                  className="btn btn-secondary"
                  disabled={!!deletingId}
                  autoFocus
                >
                  Batal
                </button>
                <button onClick={() => executeDelete(confirmDelete.id)} className="btn btn-danger" disabled={!!deletingId}>
                  {deletingId ? (
                    <>
                      <Loader2 size={14} className="spin-icon" aria-hidden="true" /> Menghapus...
                    </>
                  ) : (
                    'Ya, Hapus'
                  )}
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
            <p className="page-subtitle">
              {isManager
                ? `${employees.length} mahasiswa & staf terdaftar di Wiramart UNPERBA`
                : 'Daftar rekan kerja & jadwal shift (Mode Pantau — Tambah/Edit Karyawan wewenang Manager Dosen)'}
            </p>
          </div>
          {isManager ? (
            <button
              id="btn-tambah-karyawan"
              onClick={() => {
                setEditData(null);
                setFocusPin(false);
                setShowModal(true);
              }}
              className="btn btn-primary"
            >
              <Plus size={16} aria-hidden="true" />
              Tambah Karyawan
            </button>
          ) : (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'hsl(215 25% 95%)',
                border: '1px solid hsl(215 20% 85%)',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'hsl(215 25% 40%)',
              }}
              title="Akses Tambah/Edit Karyawan khusus untuk Manager (Dosen)"
            >
              <ShieldCheck size={15} color="#64748b" />
              <span>Mode Pantau Operasional</span>
            </div>
          )}
        </div>

        {/* ── BANNER: Admin Shift Belum Punya PIN (Manager Only) ── */}
        {isManager && (() => {
          const noPinAdmins = employees.filter(
            (e) => e.isActive && e.isKetuaShift && !e.hasPin
          );
          if (noPinAdmins.length === 0) return null;
          return (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                background: 'hsl(38 100% 95%)',
                border: '1.5px solid hsl(38 90% 70%)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <AlertTriangle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#92400e', marginBottom: 4 }}>
                  ⚠️ {noPinAdmins.length} Admin Shift Belum Punya PIN Login
                </div>
                <div style={{ fontSize: '0.75rem', color: '#78350f', lineHeight: 1.6 }}>
                  Mereka tidak bisa akses halaman Admin Dashboard sampai PIN diset oleh Manager.
                  Klik nama untuk edit &amp; set PIN.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {noPinAdmins.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        setEditData(emp);
                        setFocusPin(true);
                        setShowModal(true);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 10px',
                        borderRadius: 20,
                        background: '#fef3c7',
                        border: '1px solid #f59e0b',
                        color: '#92400e',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title={`Set PIN untuk ${emp.fullName} (NIM: ${emp.nim})`}
                    >
                      <Crown size={11} color="#ca8a04" />
                      {emp.fullName}
                      <span style={{ fontSize: '0.65rem', color: '#b45309', marginLeft: 2 }}>
                        · {emp.nim}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Search & Role Filter Bar */}
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div
            className="card-body"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {/* Search Input */}
            <div className="form-input-icon" style={{ flex: '1 1 280px', maxWidth: 360 }}>
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

            {/* Role Filter Pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
                <Filter size={13} /> Filter:
              </span>
              {['Semua', 'Kasir', 'Gudang', 'CS Pelayan', 'Admin Shift'].map((role) => {
                const isActive = activeRoleFilter === role;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setActiveRoleFilter(role)}
                    style={{
                      background: isActive ? 'var(--color-primary)' : 'var(--color-surface-muted)',
                      color: isActive ? '#fff' : 'var(--color-text-muted)',
                      border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderRadius: '999px',
                      padding: '4px 11px',
                      fontSize: '0.75rem',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tabel Karyawan */}
        <div className="card">
          {loading ? (
            <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Loader2 size={32} style={{ margin: '0 auto', animation: 'spin 1s linear infinite' }} />
              <p className="text-sm" style={{ marginTop: 'var(--space-3)' }}>
                Memuat data karyawan...
              </p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Users size={40} style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }} />
              <p className="text-sm">
                {search || activeRoleFilter !== 'Semua'
                  ? `Tidak ada karyawan ditemukan untuk kriteria pencarian ini.`
                  : 'Belum ada karyawan terdaftar. Klik "Tambah Karyawan" untuk memulai.'}
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
                    <th scope="col">PIN Shift</th>
                    <th scope="col">Jadwal Shift</th>
                    <th scope="col">Status</th>
                    <th scope="col">Sesi Kasir</th>
                    <th scope="col" className="text-right">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id}>
                      <td className="allow-wrap" style={{ fontWeight: 'var(--weight-medium)' }}>
                        <div>{emp.fullName}</div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{emp.nim}</td>
                      <td className="allow-wrap">{emp.programStudi}</td>
                      <td>{renderJabatanBadge(emp.jabatan)}</td>
                      {/* PIN Shift Status */}
                      <td>
                        {emp.hasPin ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'hsl(142 70% 45% / 0.12)',
                              color: 'hsl(142 60% 32%)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Key size={11} /> Aktif
                          </span>
                        ) : emp.jabatan.toLowerCase().includes('admin') || emp.isKetuaShift ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'hsl(38 95% 50% / 0.15)',
                              color: 'hsl(38 90% 30%)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <AlertTriangle size={11} /> Belum Ada
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        {emp.allShifts && emp.allShifts.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {emp.allShifts.map((s) => (
                              <span
                                key={s.slotId}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'hsl(142 70% 45% / 0.12)',
                                  color: 'hsl(142 60% 38%)',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {s.day} {s.start}-{s.end}
                              </span>
                            ))}
                          </div>
                        ) : emp.shiftDay && emp.shiftStart && emp.shiftEnd ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'hsl(142 70% 45% / 0.12)',
                              color: 'hsl(142 60% 38%)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {emp.shiftDay} {emp.shiftStart}-{emp.shiftEnd}
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              background: 'hsl(0 0% 50% / 0.1)',
                              color: 'var(--color-text-muted)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Belum dijadwal
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${emp.isActive ? 'badge-success' : 'badge-error'}`}>
                          {emp.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      {/* Sesi kasir aktif */}
                      <td>
                        {emp.activeShiftId ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              background: 'hsl(142 70% 45% / 0.12)',
                              color: 'hsl(142 55% 35%)',
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: 'hsl(142 60% 40%)',
                                display: 'inline-block',
                                boxShadow: '0 0 0 2px hsl(142 60% 40% / 0.3)',
                                animation: 'pulse 1.5s ease-in-out infinite',
                              }}
                            />
                            Online
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              background: 'hsl(0 0% 50% / 0.08)',
                              color: 'var(--color-text-muted)',
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                            }}
                          >
                            Offline
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {/* Toggle aktif — KHUSUS MANAGER */}
                          {isManager && (
                            <button
                              onClick={() => handleToggleActive(emp)}
                              className="btn btn-ghost btn-sm"
                              title={emp.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                              aria-label={`${emp.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${emp.fullName}`}
                              style={{ color: emp.isActive ? 'var(--color-warning)' : 'var(--color-success)' }}
                            >
                              {emp.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                            </button>
                          )}

                          {/* Kelola PIN — KHUSUS MANAGER */}
                          {isManager && (
                            <button
                              onClick={() => {
                                setEditData(emp);
                                setFocusPin(true);
                                setShowModal(true);
                              }}
                              className="btn btn-ghost btn-sm"
                              title={emp.hasPin ? 'Ganti / Hapus PIN Shift' : 'Pasang PIN Shift Baru'}
                              aria-label={`Kelola PIN untuk ${emp.fullName}`}
                              style={{ color: emp.hasPin ? 'var(--color-primary)' : 'hsl(38 95% 45%)' }}
                            >
                              <Key size={15} />
                            </button>
                          )}

                          {/* Edit — KHUSUS MANAGER */}
                          {isManager && (
                            <button
                              onClick={() => {
                                setEditData(emp);
                                setFocusPin(false);
                                setShowModal(true);
                              }}
                              className="btn btn-ghost btn-sm"
                              title="Edit karyawan"
                              aria-label={`Edit ${emp.fullName}`}
                            >
                              <Edit2 size={15} />
                            </button>
                          )}

                          {/* Force Logout — Kasir Online (Bisa untuk Manager & Admin Shift untuk reset sesi kasir yang nyangkut) */}
                          {emp.activeShiftId && (
                            <button
                              onClick={() => handleResetSesi(emp)}
                              className="btn btn-ghost btn-sm"
                              title="Force Logout — tutup sesi aktif kasir ini (berguna saat pergantian shift)"
                              aria-label={`Force logout ${emp.fullName}`}
                              disabled={resettingId === emp.id}
                              style={{ color: 'hsl(25 95% 53%)' }}
                            >
                              {resettingId === emp.id ? (
                                <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                              ) : (
                                <LogOut size={15} />
                              )}
                            </button>
                          )}

                          {/* Hapus — KHUSUS MANAGER */}
                          {isManager && (
                            <button
                              onClick={() => handleDelete(emp.id, emp.fullName)}
                              className="btn btn-ghost btn-sm"
                              title="Hapus karyawan"
                              aria-label={`Hapus ${emp.fullName}`}
                              disabled={deletingId === emp.id}
                              style={{ color: 'var(--color-error)' }}
                            >
                              {deletingId === emp.id ? (
                                <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          )}

                          {/* Jika bukan manager dan kasir tidak online, tampilkan tanda strip read-only */}
                          {!isManager && !emp.activeShiftId && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '0 6px' }}>
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Tambah / Edit */}
        {showModal && isManager && (
          <KaryawanModal
            editData={editData}
            initialFocusPin={focusPin}
            onClose={() => {
              setShowModal(false);
              setFocusPin(false);
            }}
            onSuccess={() => fetchEmployees(search)}
          />
        )}
      </div>
    </>
  );
}
