'use client';

import { useState, useId, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  LogIn, AlertCircle, User, Hash, GraduationCap, CheckCircle2,
  Clock, Calendar, UserCheck, ChevronRight, RefreshCw, Sparkles,
  ShoppingBag, Package, ShieldCheck, HeartHandshake
} from 'lucide-react';

type ShiftPersonnel = {
  scheduleId: string;
  orderInSlot: number;
  employeeId: string | null;
  fullName: string | null;
  nim: string | null;
  programStudi: string | null;
  defaultJabatan: string | null;
  attendance: {
    isAttended: boolean;
    isClockedOut?: boolean;
    status?: string;
    clockInTime?: string | null;
    clockOutTime?: string | null;
    lateMinutes?: number;
    notes?: string | null;
  };
};

type ShiftGroup = {
  slotStart: string;
  slotEnd: string;
  label: string;
  isCurrent: boolean;
  coordinator: string | null;
  personnel: ShiftPersonnel[];
};

type PresensiData = {
  hari: string;
  tanggal: string;
  jamSekarang: string;
  toleransiMenit: number;
  shifts: ShiftGroup[];
};

type RoleOption = 'Admin Shift' | 'Kepala Gudang' | 'Kasir' | 'Customer Service' | 'Ketua Admin' | 'Pelayan' | 'Gudang' | 'Admin Kasir';

export default function KasirLoginPage() {
  const router = useRouter();
  const nameId = useId();
  const nimId = useId();
  const prodiId = useId();

  // Tab State: 'presensi' = Kiosk Presensi Semua Orang, 'pos' = Login Kasir POS
  const [activeTab, setActiveTab] = useState<'presensi' | 'pos'>('presensi');

  // Form State (POS Login)
  const [form, setForm] = useState({ fullName: '', nim: '', programStudi: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Presensi State
  const [presensiData, setPresensiData] = useState<PresensiData | null>(null);
  const [loadingPresensi, setLoadingPresensi] = useState(true);
  const [presensiError, setPresensiError] = useState<string | null>(null);
  const [presensiSuccessMsg, setPresensiSuccessMsg] = useState<string | null>(null);

  // Selected employee for presensi modal / inline action
  const [selectedPerson, setSelectedPerson] = useState<ShiftPersonnel | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleOption>('Kasir');
  const [submittingPresensi, setSubmittingPresensi] = useState(false);

  // Fetch presensi hari ini
  async function loadPresensi() {
    setLoadingPresensi(true);
    setPresensiError(null);
    try {
      const res = await fetch('/api/kasir/presensi-hari-ini');
      const json = await res.json() as { success: boolean; data?: PresensiData; error?: string };
      if (json.success && json.data) {
        setPresensiData(json.data);
      } else {
        setPresensiError(json.error ?? 'Gagal memuat jadwal hari ini.');
      }
    } catch {
      setPresensiError('Koneksi terputus. Pastikan server aktif.');
    } finally {
      setLoadingPresensi(false);
    }
  }

  useEffect(() => {
    loadPresensi();
  }, []);

  function handleFormChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (error) setError(null);
    };
  }

  // Handle Submit Absen Karyawan
  async function handleConfirmPresensi() {
    if (!selectedPerson || !selectedPerson.employeeId) return;

    setSubmittingPresensi(true);
    setPresensiError(null);
    setPresensiSuccessMsg(null);

    try {
      const res = await fetch('/api/kasir/presensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:     'CLOCK_IN',
          employeeId: selectedPerson.employeeId,
          scheduleId: selectedPerson.scheduleId,
          roleTask:   selectedRole,
        }),
      });

      const json = await res.json() as { success: boolean; message?: string; error?: string };
      if (!res.ok || !json.success) {
        setPresensiError(json.error ?? 'Gagal mencatat presensi.');
        return;
      }

      setPresensiSuccessMsg(json.message ?? `Presensi berhasil! Selamat bertugas sebagai ${selectedRole}.`);
      
      // Auto-fill login POS jika orang ini bertugas sebagai Kasir atau Admin Shift
      if (selectedRole === 'Kasir' || selectedRole === 'Admin Shift' || selectedRole === 'Ketua Admin') {
        setForm({
          fullName:     selectedPerson.fullName ?? '',
          nim:          selectedPerson.nim ?? '',
          programStudi: selectedPerson.programStudi ?? '',
        });
      }

      setSelectedPerson(null);
      await loadPresensi(); // Refresh daftar agar badge langsung hijau
    } catch {
      setPresensiError('Gagal menghubungi server.');
    } finally {
      setSubmittingPresensi(false);
    }
  }

  // Handle Presensi Pulang (Clock-Out)
  async function handleClockOut(p: ShiftPersonnel) {
    if (!p.employeeId) return;
    const confirmOut = window.confirm(`Konfirmasi presensi pulang untuk ${p.fullName}?`);
    if (!confirmOut) return;

    setPresensiError(null);
    setPresensiSuccessMsg(null);
    try {
      const res = await fetch('/api/kasir/presensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:     'CLOCK_OUT',
          employeeId: p.employeeId,
          scheduleId: p.scheduleId,
        }),
      });
      const json = await res.json() as { success: boolean; message?: string; error?: string };
      if (!res.ok || !json.success) {
        setPresensiError(json.error ?? 'Gagal mencatat presensi pulang.');
        return;
      }
      setPresensiSuccessMsg(json.message ?? `Presensi pulang berhasil dicatat untuk ${p.fullName}.`);
      await loadPresensi();
    } catch {
      setPresensiError('Gagal menghubungi server.');
    }
  }

  // Handle Login Kasir ke POS
  async function handlePosLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const { fullName, nim, programStudi } = form;
    if (!fullName.trim() || !nim.trim() || !programStudi.trim()) {
      setError('Semua kolom wajib diisi: Nama Lengkap, NIM, dan Program Studi.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/kasir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:     fullName.trim(),
          nim:          nim.trim(),
          programStudi: programStudi.trim(),
        }),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { redirect?: string; name?: string; shiftId?: string };
        error?: string;
        code?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        setError(json.error ?? 'Data tidak ditemukan. Periksa kembali Nama, NIM, dan Program Studi Anda.');
        return;
      }

      router.push(json.data.redirect ?? '/kasir/pos');
      router.refresh();
    } catch {
      setError('Koneksi gagal. Periksa jaringan internet Anda.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-wrapper" style={{ padding: 'var(--space-4)' }}>
      <main
        className="auth-card"
        role="main"
        style={{
          maxWidth: activeTab === 'presensi' ? 520 : 420,
          transition: 'max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Logo */}
        <div className="auth-logo" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ width: 64, height: 64, position: 'relative' }}>
            <Image
              src="/logo.png"
              alt="Logo Wiramart UNPERBA"
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div>
            <div className="auth-logo-name">WIRAMART UNPERBA</div>
            <div className="auth-logo-sub">Unit Kegiatan Mahasiswa Kewirausahaan</div>
          </div>
        </div>

        {/* Tab Navigation Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            padding: 4,
            backgroundColor: 'var(--color-surface-muted, #f1f5f9)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 'var(--space-5)',
          }}
        >
          <button
            type="button"
            onClick={() => { setActiveTab('presensi'); setError(null); }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === 'presensi' ? 'var(--weight-bold)' : 'var(--weight-medium)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: activeTab === 'presensi' ? 'white' : 'transparent',
              color: activeTab === 'presensi' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              boxShadow: activeTab === 'presensi' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <UserCheck size={15} />
            <span>1. Presensi Shift</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('pos'); setPresensiError(null); setPresensiSuccessMsg(null); }}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === 'pos' ? 'var(--weight-bold)' : 'var(--weight-medium)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: activeTab === 'pos' ? 'white' : 'transparent',
              color: activeTab === 'pos' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              boxShadow: activeTab === 'pos' ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <LogIn size={15} />
            <span>2. Buka Kasir POS</span>
          </button>
        </div>

        {/* ─── TAB 1: KIOSK PRESENSI SHIFT (SEMUA ORANG) ─── */}
        {activeTab === 'presensi' && (
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h1 className="auth-title" style={{ fontSize: 'var(--text-lg)', marginBottom: 4 }}>
                Presensi Masuk Shift
              </h1>
              <p className="auth-subtitle" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                Semua anggota shift (Kasir, Gudang, Admin Kasir) absen di sini sebelum bertugas.
              </p>
            </div>

            {/* Info Waktu & Toleransi */}
            {presensiData && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-primary-light)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'var(--weight-semibold)' }}>
                  <Calendar size={14} />
                  <span>{presensiData.hari}, {presensiData.tanggal}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} />
                  <span>Jam Sekarang: <strong>{presensiData.jamSekarang} WIB</strong></span>
                </div>
              </div>
            )}

            {/* Success Alert */}
            {presensiSuccessMsg && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: '10px 12px',
                  backgroundColor: 'var(--color-success-light, #dcfce7)',
                  border: '1px solid var(--color-success)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  color: 'var(--color-success)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                }}
              >
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                <span>{presensiSuccessMsg}</span>
              </div>
            )}

            {/* Error Alert */}
            {presensiError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: '10px 12px',
                  backgroundColor: 'var(--color-error-light)',
                  border: '1px solid var(--color-error)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  color: 'var(--color-error)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-medium)',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{presensiError}</span>
              </div>
            )}

            {/* Loading */}
            {loadingPresensi ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
                <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto var(--space-2)' }} />
                <p style={{ fontSize: 'var(--text-xs)' }}>Memuat jadwal shift hari ini...</p>
              </div>
            ) : !presensiData || presensiData.shifts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)' }}>
                <Calendar size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Tidak ada jadwal shift terdaftar untuk hari ini.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {presensiData.shifts.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: s.isCurrent ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-3)',
                      backgroundColor: s.isCurrent ? 'var(--color-surface, white)' : 'var(--color-surface-muted, #fafafa)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                          Shift {idx === 0 ? 'Pagi' : 'Siang'}: {s.label}
                        </span>
                        {s.isCurrent && (
                          <span style={{ backgroundColor: 'var(--color-primary)', color: 'white', fontSize: 10, padding: '2px 6px', borderRadius: 10, fontWeight: 'bold' }}>
                            AKTIF
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {s.personnel.filter(p => p.attendance.isAttended).length} / {s.personnel.length} Hadir
                      </span>
                    </div>

                    {/* Personnel List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.personnel.map((p) => {
                        const isAttended = p.attendance.isAttended;
                        return (
                          <div
                            key={p.scheduleId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-md)',
                              backgroundColor: isAttended ? 'rgba(34, 197, 94, 0.08)' : 'white',
                              border: isAttended ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid var(--color-border)',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                {p.fullName}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 8 }}>
                                <span>NIM: {p.nim}</span>
                                {p.attendance.notes && (
                                  <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>
                                    {p.attendance.notes}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Status / Action Button */}
                            {isAttended ? (
                              <div style={{ textAlign: 'right' }}>
                                {p.attendance.isClockedOut ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      fontSize: 11,
                                      fontWeight: 'bold',
                                      color: 'var(--color-primary)',
                                      backgroundColor: 'var(--color-primary-light)',
                                      padding: '3px 8px',
                                      borderRadius: 999,
                                    }}
                                  >
                                    🏁 Selesai ({p.attendance.clockInTime} – {p.attendance.clockOutTime})
                                  </span>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: 11,
                                        fontWeight: 'bold',
                                        color: p.attendance.status === 'TELAT' ? '#d97706' : '#15803d',
                                        backgroundColor: p.attendance.status === 'TELAT' ? '#fef3c7' : '#dcfce7',
                                        padding: '3px 8px',
                                        borderRadius: 999,
                                      }}
                                    >
                                      <CheckCircle2 size={12} />
                                      {p.attendance.status === 'TELAT' ? `Telat (${p.attendance.clockInTime})` : `Hadir (${p.attendance.clockInTime})`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleClockOut(p)}
                                      className="btn btn-secondary"
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: 10,
                                        fontWeight: 'var(--weight-bold)',
                                        borderRadius: 'var(--radius-sm)',
                                      }}
                                      title="Presensi Pulang (Clock-Out)"
                                    >
                                      Pulang
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPerson(p);
                                  setSelectedRole('Kasir');
                                  setPresensiError(null);
                                }}
                                className="btn btn-primary"
                                style={{
                                  padding: '5px 12px',
                                  fontSize: 'var(--text-xs)',
                                  borderRadius: 'var(--radius-md)',
                                }}
                              >
                                Absen Masuk
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Bottom Shortcut to POS */}
            <div style={{ marginTop: 'var(--space-6)', textAlign: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="btn btn-secondary btn-full"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontSize: 'var(--text-xs)',
                  padding: '10px 14px',
                }}
              >
                <span>Sudah absen semua? Buka Kasir POS</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ─── MODAL INLINE PILIH PERAN PRESENSI ─── */}
        {selectedPerson && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 'var(--space-4)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: 380,
                width: '100%',
                backgroundColor: 'white',
                borderRadius: 'var(--radius-xl)',
                padding: 'var(--space-5)',
                boxShadow: 'var(--shadow-xl)',
              }}
            >
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', marginBottom: 4 }}>
                Konfirmasi Presensi
              </h2>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                {selectedPerson.fullName} (NIM: {selectedPerson.nim})
              </p>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', display: 'block', marginBottom: 8 }}>
                  Pilih Tugas Shift Anda Hari Ini:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { role: 'Admin Shift', desc: 'Koordinator shift, monitoring tim & otorisasi operasional', icon: <ShieldCheck size={16} /> },
                    { role: 'Kepala Gudang', desc: 'Logistik, terima barang supplier, cek batch & expired', icon: <Package size={16} /> },
                    { role: 'Kasir', desc: 'Melayani transaksi belanja, laci uang & scanning POS', icon: <ShoppingBag size={16} /> },
                    { role: 'Customer Service', desc: 'Layanan pelanggan, cek harga rak, display etalase', icon: <HeartHandshake size={16} /> },
                  ].map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      onClick={() => setSelectedRole(item.role as RoleOption)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: selectedRole === item.role ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        backgroundColor: selectedRole === item.role ? 'var(--color-primary-light)' : 'white',
                        color: selectedRole === item.role ? 'var(--color-primary)' : 'var(--color-text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ color: selectedRole === item.role ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                        {item.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)' }}>{item.role}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setSelectedPerson(null)}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: 8, fontSize: 'var(--text-xs)' }}
                  disabled={submittingPresensi}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPresensi}
                  className="btn btn-primary"
                  style={{ flex: 2, padding: 8, fontSize: 'var(--text-xs)' }}
                  disabled={submittingPresensi}
                >
                  {submittingPresensi ? 'Mencatat...' : 'Konfirmasi Hadir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: LOGIN KASIR POS ─── */}
        {activeTab === 'pos' && (
          <div>
            <h1 className="auth-title">Login Karyawan Kasir</h1>
            <p className="auth-subtitle">
              Khusus petugas <strong>Kasir</strong> untuk membuka sesi POS & laci uang.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--color-primary-light)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-5)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-primary)',
                fontWeight: 'var(--weight-medium)',
              }}
              role="note"
            >
              <GraduationCap size={16} aria-hidden="true" />
              <span>Sesi laci uang akan otomatis dibuka untuk kasir ini.</span>
            </div>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  backgroundColor: 'var(--color-error-light)',
                  border: '1px solid var(--color-error)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-4)',
                  color: 'var(--color-error)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-medium)',
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handlePosLogin} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor={nameId}>
                  Nama Lengkap <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <User
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={nameId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Dwi Lia Rahmania"
                    value={form.fullName}
                    onChange={handleFormChange('fullName')}
                    autoComplete="name"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={nimId}>
                  NIM <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Hash
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={nimId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 02401083"
                    value={form.nim}
                    onChange={handleFormChange('nim')}
                    autoComplete="off"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={prodiId}>
                  Program Studi <span className="required" aria-hidden="true">*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <GraduationCap
                    size={16}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    id={prodiId}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Manajemen"
                    value={form.programStudi}
                    onChange={handleFormChange('programStudi')}
                    autoComplete="off"
                    required
                    disabled={isLoading}
                    style={{ paddingLeft: 'calc(var(--space-3) + 16px + var(--space-2))' }}
                  />
                </div>
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-full btn-lg ${isLoading ? 'btn-loading' : ''}`}
                disabled={isLoading}
                aria-busy={isLoading}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {!isLoading && (
                  <>
                    <LogIn size={20} aria-hidden="true" />
                    Buka Kasir POS
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Back to admin login */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center',
          }}
        >
          <a
            href="/login"
            className="text-sm text-muted"
            style={{
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              fontWeight: 'var(--weight-medium)',
              transition: 'color var(--duration-fast)',
            }}
          >
            ← Login sebagai Admin Dosen
          </a>
        </div>
      </main>
    </div>
  );
}
