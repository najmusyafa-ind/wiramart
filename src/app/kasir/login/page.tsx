'use client';

import { useState, useId, useEffect, useMemo } from 'react';
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

type RoleOption = 'Kasir' | 'Gudang' | 'CS Pelayan' | 'Admin Shift';

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
  const [selectedShiftGroup, setSelectedShiftGroup] = useState<ShiftGroup | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleOption>('Kasir');
  const [submittingPresensi, setSubmittingPresensi] = useState(false);

  // Deteksi kuota peran di shift yang sedang dipilih:
  // Admin Kasir & Kasir: Maksimal 1 orang per shift (laci/otorisasi tunggal).
  // Gudang & CS Pelayan: Fleksibel / Boleh > 1 orang (unlimited).
  const takenRolesInCurrentShift = useMemo(() => {
    if (!selectedShiftGroup) return { kasirOccupant: null, adminOccupant: null };
    let kasirOccupant: string | null = null;
    let adminOccupant: string | null = null;

    for (const person of selectedShiftGroup.personnel) {
      if (person.attendance.isAttended && person.employeeId !== selectedPerson?.employeeId) {
        const notes = person.attendance.notes ?? '';
        if (notes.includes('Peran: Kasir')) {
          kasirOccupant = person.fullName ?? 'Rekan Kasir';
        }
        if (notes.includes('Peran: Admin Shift') || notes.includes('Peran: Ketua Admin')) {
          adminOccupant = person.fullName ?? 'Rekan Admin Shift';
        }
      }
    }
    return { kasirOccupant, adminOccupant };
  }, [selectedShiftGroup, selectedPerson]);

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

  // Demo Mode State (Hanya aktif jika URL menyertakan ?demo=1 / ?demo=true)
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    loadPresensi();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const isDemo = params.get('demo') === '1' || params.get('demo') === 'true';
      setIsDemoMode(isDemo);

      const fromParam = params.get('from');
      if (fromParam && fromParam.includes('gudang')) {
        setActiveTab('pos');
        if (isDemo) {
          setForm({
            fullName: 'Khalila Sevina Nurani',
            nim: '02601011',
            programStudi: 'Manajemen',
          });
        }
      }
    }
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
      
      // Khusus Petugas Gudang: Auto-login & langsung arahkan ke Portal Gudang
      if (selectedRole === 'Gudang') {
        try {
          const authRes = await fetch('/api/auth/kasir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullName:     selectedPerson.fullName ?? '',
              nim:          selectedPerson.nim ?? '',
              programStudi: selectedPerson.programStudi ?? '',
            }),
          });
          const authJson = await authRes.json() as { success: boolean; data?: { redirect?: string } };
          if (authJson.success && authJson.data?.redirect) {
            router.push(authJson.data.redirect);
            return;
          }
        } catch {
          // Fallback: biarkan user melihat pesan sukses
        }
      }

      // Auto-fill login POS jika orang ini bertugas sebagai Kasir atau Admin Shift
      if (selectedRole === 'Kasir' || selectedRole === 'Admin Shift') {
        setForm({
          fullName:     selectedPerson.fullName ?? '',
          nim:          selectedPerson.nim ?? '',
          programStudi: selectedPerson.programStudi ?? '',
        });
      }

      setSelectedPerson(null);
      setSelectedShiftGroup(null);
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
    <div className="auth-wrapper">
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
            <span>2. Login Petugas (Kasir &amp; Gudang)</span>
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

            {/* Loading & Status Operasional Berdasarkan Hari & Jam WIB */}
            {loadingPresensi ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
                <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto var(--space-2)' }} />
                <p style={{ fontSize: 'var(--text-xs)' }}>Memuat jadwal shift hari ini...</p>
              </div>
            ) : (() => {
              const hariUpper = (presensiData?.hari ?? '').toUpperCase();
              const isWeekday = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'].includes(hariUpper);
              
              const [h, m] = (presensiData?.jamSekarang ?? '00:00').split(':').map(Number);
              const totalMenit = (h ?? 0) * 60 + (m ?? 0);

              let isWeekendActive = false;
              let isWeekendClosed = false;
              let isWeekdayClosed = false;

              if (isWeekday) {
                // Hari Kerja (Senin - Jumat):
                // Sesuai instruksi: Halaman absensi shift HARUS KELIHATAN MULAI JAM 05:00 SUBUH (300 m) s/d 22:00 MALAM (1320 m)
                if (totalMenit < 5 * 60 || totalMenit > 22 * 60) {
                  isWeekdayClosed = true;
                }
              } else {
                // Akhir Pekan (Sabtu & Minggu):
                if (hariUpper === 'SABTU') {
                  // Sabtu buka 06:00 (360) s/d 21:00 (1260)
                  if (totalMenit >= 6 * 60 && totalMenit <= 21 * 60) {
                    isWeekendActive = true;
                  } else {
                    isWeekendClosed = true;
                  }
                } else if (hariUpper === 'MINGGU') {
                  // Minggu buka 06:00 (360) s/d 22:00 (1320)
                  if (totalMenit >= 6 * 60 && totalMenit <= 22 * 60) {
                    isWeekendActive = true;
                  } else {
                    isWeekendClosed = true;
                  }
                } else {
                  isWeekendClosed = true;
                }
              }

              // ── Hari Kerja Sebelum Jam 05:00 Subuh atau Setelah Jam 22:00 Malam ──
              if (isWeekdayClosed) {
                return (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-6) var(--space-4)',
                      backgroundColor: 'var(--color-surface-muted, #f8fafc)',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        color: 'var(--color-primary)',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 'bold',
                        marginBottom: 12,
                      }}
                    >
                      <Clock size={13} />
                      <span>Istirahat Malam Operasional Toko</span>
                    </div>
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: '0 0 6px', color: 'var(--color-text)' }}>
                      Toko Istirahat Malam ({presensiData?.jamSekarang} WIB)
                    </h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-4)', lineHeight: 1.5 }}>
                      Halaman absensi &amp; jadwal shift perkuliahan reguler hari {presensiData?.hari} akan <strong>otomatis aktif mulai pukul 05:00 Subuh WIB</strong> agar petugas dapat memeriksa jadwal dan bersiap lebih awal.
                    </p>
                    <div style={{ maxWidth: 280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pos')}
                        className="btn btn-primary"
                        style={{ fontSize: 'var(--text-xs)', padding: '8px 12px' }}
                      >
                        Buka Form Login Petugas
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push('/login')}
                        className="btn btn-secondary"
                        style={{ fontSize: 'var(--text-xs)', padding: '8px 12px' }}
                      >
                        Login Pengelola (Admin &amp; Manager)
                      </button>
                    </div>
                  </div>
                );
              }

              // ── Jendela Weekend Aktif (Sabtu 06-21 / Minggu 06-22): Opname & Restock ──
              if (isWeekendActive) {
                return (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-6) var(--space-4)',
                      backgroundColor: 'var(--color-surface-muted, #f8fafc)',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        color: 'var(--color-primary)',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 'bold',
                        marginBottom: 12,
                      }}
                    >
                      <Package size={13} />
                      <span>Sesi Akhir Pekan: Evaluasi, Opname &amp; Restock</span>
                    </div>
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: '0 0 6px', color: 'var(--color-text)' }}>
                      Operasional Gudang &amp; Logistik ({presensiData?.hari})
                    </h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-4)', lineHeight: 1.5 }}>
                      Hari ini jadwal kuliah shift reguler libur. Sistem aktif khusus untuk evaluasi mingguan, opname fisik barang, restock kiriman supplier, dan radar FEFO (Buka s.d. pukul {hariUpper === 'SABTU' ? '21:00' : '22:00'} WIB).
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320, margin: '0 auto' }}>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pos')}
                        className="btn btn-primary"
                        style={{
                          fontSize: 'var(--text-xs)',
                          padding: '8px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <Package size={14} />
                        <span>Masuk Portal Petugas Gudang &amp; FEFO</span>
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pos')}
                        className="btn btn-secondary"
                        style={{ fontSize: 'var(--text-xs)', padding: '8px 12px' }}
                      >
                        Buka Kasir POS Khusus
                      </button>
                    </div>
                  </div>
                );
              }

              // ── Jendela Weekend Tutup (Malam Hari: Sabtu >21:00 / Minggu >22:00) ──
              if (isWeekendClosed) {
                return (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-6) var(--space-4)',
                      backgroundColor: 'var(--color-surface-muted, #f8fafc)',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 'bold',
                        marginBottom: 12,
                      }}
                    >
                      <Clock size={13} />
                      <span>Jendela Operasional Akhir Pekan Ditutup</span>
                    </div>
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: '0 0 6px', color: 'var(--color-text)' }}>
                      Toko &amp; Gudang Tutup ({presensiData?.jamSekarang} WIB)
                    </h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-4)', lineHeight: 1.5 }}>
                      {hariUpper === 'MINGGU'
                        ? 'Sesi opname & restock akhir pekan telah selesai (Sabtu tutup 21:00 WIB, Minggu tutup 22:00 WIB). Presensi shift perkuliahan reguler akan otomatis aktif kembali besok hari Senin pukul 05:00 Subuh WIB.'
                        : 'Sesi opname akhir pekan ditutup pukul 21:00 WIB. Operasional gudang akan dibuka kembali besok hari Minggu pukul 06:00 WIB.'}
                    </p>
                    <div style={{ maxWidth: 300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pos')}
                        className="btn btn-primary"
                        style={{ fontSize: 'var(--text-xs)', padding: '8px 12px' }}
                      >
                        Buka Form Login Petugas (Kasir &amp; Gudang)
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push('/login')}
                        className="btn btn-secondary"
                        style={{ fontSize: 'var(--text-xs)', padding: '8px 12px' }}
                      >
                        Login Pengelola (Admin Shift &amp; Manager)
                      </button>
                    </div>
                  </div>
                );
              }

              // ── Hari Kerja tetapi tidak ada shift (misal hari libur nasional) ──
              if (!presensiData || presensiData.shifts.length === 0) {
                return (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-6) var(--space-4)',
                      backgroundColor: 'var(--color-surface-muted, #f8fafc)',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    <Calendar size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 8px' }} />
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: '0 0 4px', color: 'var(--color-text)' }}>
                      Tidak Ada Jadwal Shift Hari Ini
                    </h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-4)' }}>
                      Tidak ditemukan jadwal shift reguler untuk hari {presensiData?.hari}.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('pos')}
                      className="btn btn-secondary"
                      style={{ fontSize: 'var(--text-xs)', padding: '6px 12px' }}
                    >
                      Buka Login Petugas
                    </button>
                  </div>
                );
              }

              // ── SENIN - JUMAT (PRODUCTION NORMAL: 43 SLOT REGULER) ──
              return (
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
                          {s.personnel.length < 4 && (
                            <span style={{ backgroundColor: 'var(--color-surface-alt, #f1f5f9)', color: 'var(--color-text-muted)', fontSize: 10, padding: '2px 6px', borderRadius: 10, border: '1px solid var(--color-border)' }}>
                              {s.personnel.length} Personel (Fleksibel)
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {s.personnel.filter(p => p.attendance.isAttended).length} / {s.personnel.length} Hadir
                        </span>
                      </div>

                      {s.personnel.length < 4 && (
                        <div style={{
                          padding: '6px 10px',
                          backgroundColor: 'rgba(59, 130, 246, 0.06)',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: 11,
                          color: 'var(--color-primary)',
                          marginBottom: 10,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <span>ℹ️ Shift fleksibel ({s.personnel.length} personel terdaftar). Anggota yang hadir dapat merangkap peran dan langsung bertugas di POS kasir.</span>
                        </div>
                      )}

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
                                    setSelectedShiftGroup(s);

                                    // Deteksi kuota terisi di shift ini
                                    let isKasirTaken = false;
                                    let isAdminTaken = false;
                                    for (const other of s.personnel) {
                                      if (other.attendance.isAttended && other.employeeId !== p.employeeId) {
                                        const n = other.attendance.notes ?? '';
                                        if (n.includes('Peran: Kasir')) isKasirTaken = true;
                                        if (n.includes('Peran: Admin Shift') || n.includes('Peran: Ketua Admin')) isAdminTaken = true;
                                      }
                                    }

                                    let initialRole: RoleOption = 'CS Pelayan';
                                    const jab = (p.defaultJabatan ?? '').toLowerCase();

                                    if (p.orderInSlot === 1 || jab.includes('admin') || jab.includes('ketua')) {
                                      initialRole = isAdminTaken ? 'CS Pelayan' : 'Admin Shift';
                                    } else if (p.orderInSlot === 3 || jab.includes('gudang')) {
                                      initialRole = 'Gudang';
                                    } else if (p.orderInSlot === 4 || jab.includes('pelayan') || jab.includes('service') || jab.includes('cs')) {
                                      initialRole = 'CS Pelayan';
                                    } else if (p.orderInSlot >= 5) {
                                      // Personel ke-5 ke atas (misal shift siang 5 orang):
                                      // Prioritaskan CS Pelayan / Gudang (bebas multi-orang)
                                      initialRole = jab.includes('gudang') ? 'Gudang' : 'CS Pelayan';
                                    } else {
                                      initialRole = isKasirTaken ? 'CS Pelayan' : 'Kasir';
                                    }

                                    setSelectedRole(initialRole);
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
              );
            })()}

            {/* Bottom Shortcut to POS */}
            <div style={{ marginTop: 'var(--space-6)', textAlign: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="btn btn-primary btn-full"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontSize: 'var(--text-xs)',
                  padding: '10px 14px',
                }}
              >
                <span>Sudah Presensi? Lanjut Buka Kasir POS Sekarang</span>
                <ChevronRight size={16} />
              </button>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                Buka kasir dapat dilakukan oleh petugas yang hadir tanpa harus menunggu 4 anggota lengkap.
              </p>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('pos')}
                  className="btn btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '11px',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-full)',
                  }}
                >
                  <Package size={13} />
                  <span>Petugas Gudang? Masuk ke Portal Inventaris &amp; FEFO</span>
                  <ChevronRight size={13} />
                </button>
              </div>
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

              {presensiError && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#dc2626',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-xs)',
                    marginBottom: 'var(--space-3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>{presensiError}</span>
                </div>
              )}

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', display: 'block', marginBottom: 8 }}>
                  Pilih Tugas Shift Anda Hari Ini:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    {
                      role: 'Kasir' as const,
                      desc: 'Melayani transaksi belanja, laci uang & scanning POS',
                      icon: <ShoppingBag size={16} />,
                      isRestricted: Boolean(takenRolesInCurrentShift.kasirOccupant),
                      restrictedMsg: `Sudah terisi oleh ${takenRolesInCurrentShift.kasirOccupant} (Maks. 1 orang per shift)`,
                      badge: takenRolesInCurrentShift.kasirOccupant ? 'SUDAH TERISI' : 'MAKS. 1 ORANG',
                      badgeColor: takenRolesInCurrentShift.kasirOccupant ? '#dc2626' : 'var(--color-primary)',
                    },
                    {
                      role: 'Admin Shift' as const,
                      desc: 'Koordinator shift, monitoring tim & otorisasi operasional',
                      icon: <ShieldCheck size={16} />,
                      isRestricted: Boolean(takenRolesInCurrentShift.adminOccupant),
                      restrictedMsg: `Sudah terisi oleh ${takenRolesInCurrentShift.adminOccupant} (Maks. 1 orang per shift)`,
                      badge: takenRolesInCurrentShift.adminOccupant ? 'SUDAH TERISI' : 'MAKS. 1 ORANG',
                      badgeColor: takenRolesInCurrentShift.adminOccupant ? '#dc2626' : 'var(--color-primary)',
                    },
                    {
                      role: 'Gudang' as const,
                      desc: 'Logistik, terima barang supplier, cek batch & expired FEFO',
                      icon: <Package size={16} />,
                      isRestricted: false,
                      badge: 'BISA > 1 ORANG',
                      badgeColor: 'var(--color-success)',
                    },
                    {
                      role: 'CS Pelayan' as const,
                      desc: 'Layanan pelanggan toko, display etalase, dan cek makanan basi',
                      icon: <HeartHandshake size={16} />,
                      isRestricted: false,
                      badge: 'BISA > 1 ORANG',
                      badgeColor: 'var(--color-success)',
                    },
                  ].map((item) => {
                    const isSelected = selectedRole === item.role;
                    const isDisabled = item.isRestricted;

                    return (
                      <button
                        key={item.role}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setSelectedRole(item.role)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                          backgroundColor: isDisabled
                            ? '#f8fafc'
                            : isSelected
                            ? 'var(--color-primary-light)'
                            : 'white',
                          color: isDisabled
                            ? 'var(--color-text-muted)'
                            : isSelected
                            ? 'var(--color-primary)'
                            : 'var(--color-text)',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          opacity: isDisabled ? 0.65 : 1,
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ color: isDisabled ? 'var(--color-text-muted)' : isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                          {item.icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)' }}>{item.role}</span>
                            <span style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 999,
                              backgroundColor: isDisabled ? '#fee2e2' : item.badgeColor === 'var(--color-success)' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                              color: item.badgeColor,
                            }}>
                              {item.badge}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: isDisabled ? '#dc2626' : 'var(--color-text-muted)' }}>
                            {isDisabled ? item.restrictedMsg : item.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPerson(null);
                    setSelectedShiftGroup(null);
                  }}
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

        {/* ─── TAB 2: LOGIN PETUGAS (KASIR & GUDANG) ─── */}
        {activeTab === 'pos' && (
          <div>
            <h1 className="auth-title">Login Petugas Shift &amp; Gudang</h1>
            <p className="auth-subtitle">
              Masuk menggunakan NIM terdaftar (berlaku untuk Kasir &amp; Petugas Logistik).
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--color-primary-light)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-primary)',
                fontWeight: 'var(--weight-medium)',
              }}
              role="note"
            >
              <Sparkles size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>
                Petugas Kasir otomatis membuka POS, sedangkan Petugas Gudang otomatis diarahkan ke Portal Gudang &amp; FEFO.
              </span>
            </div>

            {/* Quick Profile Chips — HANYA TAMPIL jika mode demo aktif (?demo=1) */}
            {isDemoMode && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--color-primary)' }}>
                    🛠️ Mode Demonstrasi Aktif (?demo=1):
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { role: 'Gudang', label: 'Khalila (Gudang)', fullName: 'Khalila Sevina Nurani', nim: '02601011', prodi: 'Manajemen' },
                    { role: 'Gudang', label: 'Bagaskara (Gudang)', fullName: 'Bagaskara Putra N.H', nim: '02505035', prodi: 'Teknik Informatika' },
                    { role: 'Kasir', label: 'Tisya (Kasir)', fullName: 'Tisya Nur Febriani', nim: '02601020', prodi: 'Manajemen' },
                    { role: 'Kasir', label: 'Dwi Lia (Kasir)', fullName: 'Dwi Lia Rahmania', nim: '02401083', prodi: 'Manajemen' },
                  ].map((item) => (
                    <button
                      key={item.nim}
                      type="button"
                      onClick={() => {
                        setForm({
                          fullName: item.fullName,
                          nim: item.nim,
                          programStudi: item.prodi,
                        });
                        if (error) setError(null);
                      }}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-md)',
                        border: form.nim === item.nim ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        backgroundColor: form.nim === item.nim ? 'var(--color-primary-light)' : 'var(--color-surface, white)',
                        color: form.nim === item.nim ? 'var(--color-primary)' : 'var(--color-text)',
                        fontSize: 11,
                        fontWeight: form.nim === item.nim ? 'bold' : 'normal',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>{item.role === 'Gudang' ? '📦' : '🛒'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                    name="kasir_fullname_no_autofill"
                    type="text"
                    className="form-input"
                    placeholder="Nama lengkap sesuai jadwal"
                    value={form.fullName}
                    onChange={handleFormChange('fullName')}
                    autoComplete="off"
                    autoCapitalize="words"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
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
                    placeholder="Contoh: 02301001"
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
                    Masuk Petugas Toko &amp; Gudang
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
            ← Login Pengelola (Admin Kasir &amp; Manager Dosen)
          </a>
        </div>
      </main>
    </div>
  );
}
