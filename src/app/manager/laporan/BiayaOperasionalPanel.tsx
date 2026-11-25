'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Receipt, Loader2, Plus, Trash2 } from 'lucide-react';
import type { PeriodKey } from '@/lib/finance/report';
import { useTableSelection } from '@/hooks/useTableSelection';
import { SelectAllCheckbox, SelectedRowsBar } from '@/components/admin/SelectedRowsBar';
import { exportSelectedRowsToExcel, todayWibSlug } from '@/lib/utils/exportSelectedExcel';
import {
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_CATEGORY_LABEL,
  formatRupiah,
  formatTanggalWib,
  noticeStyle,
  type ExpenseCategoryKey,
  type ExpenseRowUi,
} from '@/features/portal/laporan/shared';

type Props = {
  period: PeriodKey;
  dateFrom?: string;
  dateTo?: string;
  /** Dipanggil setelah biaya ditambah/dihapus agar kartu & rekap laporan dimuat ulang. */
  onChanged: () => void;
};

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: string };

const MAX_AMOUNT = 100_000_000;

/** Tanggal hari ini menurut WIB (YYYY-MM-DD), terlepas dari zona waktu perangkat. */
function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function BiayaOperasionalPanel({ period, dateFrom, dateTo, onChanged }: Props) {
  const uid = useId();
  const selection = useTableSelection();
  // Hasil muat disimpan bersama kunci permintaannya; "loading" = hasil belum sesuai kunci terkini.
  const [tick, setTick] = useState(0);
  const hasCustomRange = Boolean(dateFrom && dateTo);
  const requestKey = `${period}:${hasCustomRange ? dateFrom : ''}:${hasCustomRange ? dateTo : ''}:${tick}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    label: string;
    rows: ExpenseRowUi[];
    truncated: boolean;
    error: string;
  } | null>(null);
  const view = loaded && loaded.key === requestKey ? loaded : null;
  const rows = useMemo(() => view?.rows ?? [], [view]);
  const rangeLabel = view?.label ?? '';
  const truncated = view?.truncated ?? false;
  const loading = view === null;
  const listError = view?.error ?? '';

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedRows = useMemo(
    () => selection.getSelectedRows(rows, (r) => r.id),
    [selection, rows],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + r.amount, 0),
    [selectedRows],
  );

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(todayWib());
  const [category, setCategory] = useState<ExpenseCategoryKey>('LISTRIK');
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formOk, setFormOk] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const key = requestKey;
    const qs = new URLSearchParams();
    if (hasCustomRange && dateFrom && dateTo) {
      qs.set('dateFrom', dateFrom);
      qs.set('dateTo', dateTo);
    } else {
      qs.set('period', period);
    }
    fetch(`/api/admin/biaya?${qs.toString()}`)
      .then(async (res) => {
        const json = (await res.json()) as ApiEnvelope<{ label?: string; rows: ExpenseRowUi[]; truncated: boolean }>;
        if (cancelled) return;
        if (!res.ok || !json.success || !json.data) {
          setLoaded({ key, label: '', rows: [], truncated: false, error: json.error ?? 'Gagal memuat daftar biaya' });
          return;
        }
        setLoaded({
          key,
          label: json.data.label ?? '',
          rows: json.data.rows,
          truncated: json.data.truncated,
          error: '',
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, label: '', rows: [], truncated: false, error: 'Terjadi kesalahan jaringan.' });
      });
    return () => { cancelled = true; };
  }, [period, dateFrom, dateTo, hasCustomRange, requestKey]);

  async function handleExportSelected(): Promise<void> {
    if (selectedRows.length === 0) return;
    await exportSelectedRowsToExcel({
      filename: `biaya-operasional-terpilih-${todayWibSlug()}.xlsx`,
      sheetName: 'Biaya Terpilih',
      title: `BIAYA OPERASIONAL TERPILIH (${selectedRows.length} Item)`,
      subtitle: `Periode: ${rangeLabel || period} | Dicetak ${todayWibSlug()} WIB`,
      rows: selectedRows,
      columns: [
        { header: 'Tanggal', key: 'expenseDate', width: 14, format: 'text', aggregate: 'none', value: (r) => r.expenseDate },
        { header: 'Hari / Tanggal', key: 'tanggalLabel', width: 20, format: 'text', aggregate: 'count', value: (r) => formatTanggalWib(r.expenseDate) },
        { header: 'Kategori', key: 'category', width: 24, format: 'text', aggregate: 'none', value: (r) => EXPENSE_CATEGORY_LABEL[r.category] ?? r.category },
        { header: 'Keterangan', key: 'description', width: 40, format: 'text', aggregate: 'none', value: (r) => r.description },
        { header: 'Nominal (Rp)', key: 'amount', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.amount },
        { header: 'Dicatat Oleh', key: 'createdByName', width: 22, format: 'text', aggregate: 'none', value: (r) => r.createdByName },
      ],
    });
  }

  const amount = amountText === '' ? 0 : Number(amountText);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError('');
    setFormOk('');
    if (description.trim().length < 3) {
      setFormError('Keterangan minimal 3 karakter.');
      return;
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      setFormError('Nominal harus antara Rp 1 dan Rp 100.000.000.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/biaya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseDate: date, category, description: description.trim(), amount }),
      });
      const json = (await res.json()) as ApiEnvelope<{ id: string; duplicate: boolean }>;
      if (!res.ok || !json.success) {
        setFormError(json.error ?? 'Gagal menyimpan biaya.');
        return;
      }
      setFormOk(json.data?.duplicate ? 'Biaya yang sama baru saja dicatat — tidak dobel.' : 'Biaya tersimpan.');
      setDescription('');
      setAmountText('');
      setTick((t) => t + 1);
      onChanged();
    } catch {
      setFormError('Terjadi kesalahan jaringan. Periksa daftar sebelum mencoba lagi.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (deleting) return;
    setDeleteError('');
    if (deleteReason.trim().length < 5) {
      setDeleteError('Alasan minimal 5 karakter.');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/biaya/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alasan: deleteReason.trim() }),
      });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !json.success) {
        setDeleteError(json.error ?? 'Gagal menghapus biaya.');
        return;
      }
      setDeleteId(null);
      setDeleteReason('');
      setTick((t) => t + 1);
      onChanged();
    } catch {
      setDeleteError('Terjadi kesalahan jaringan.');
    } finally {
      setDeleting(false);
    }
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }} aria-labelledby={`${uid}-title`}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h2
          id={`${uid}-title`}
          className="card-title"
          style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <Receipt size={16} aria-hidden="true" /> Biaya Operasional
          {rangeLabel && (
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-normal)', color: 'var(--color-text-muted)' }}>
              ({rangeLabel})
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Total: <strong>{formatRupiah(total)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className={`btn btn-sm ${showForm ? 'btn-secondary' : 'btn-primary'}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={13} aria-hidden="true" />
            <span>{showForm ? 'Tutup Form' : 'Catat Biaya'}</span>
          </button>
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* ── Form tambah (dibuka saat tombol diklik) ── */}
        {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            backgroundColor: 'var(--color-surface-alt)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Row 1: Tanggal, Kategori, Nominal */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-3)',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-date`} className="form-label" style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                Tanggal Transaksi
              </label>
              <input
                id={`${uid}-date`}
                type="date"
                className="form-input"
                value={date}
                max={todayWib()}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-cat`} className="form-label" style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                Kategori Biaya
              </label>
              <select
                id={`${uid}-cat`}
                className="form-input form-select"
                style={{ width: '100%' }}
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategoryKey)}
              >
                {EXPENSE_CATEGORY_KEYS.map((k) => (
                  <option key={k} value={k}>{EXPENSE_CATEGORY_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-amt`} className="form-label" style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                Nominal (Rp)
              </label>
              <input
                id={`${uid}-amt`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="form-input"
                placeholder="0"
                value={amountText === '' ? '' : Number(amountText).toLocaleString('id-ID')}
                onChange={(e) => setAmountText(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9))}
                required
              />
            </div>
          </div>

          {/* Row 2: Keterangan & Tombol Submit */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div className="form-group" style={{ margin: 0, flex: '1 1 280px' }}>
              <label htmlFor={`${uid}-desc`} className="form-label" style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                Keterangan / Rincian Pengeluaran
              </label>
              <input
                id={`${uid}-desc`}
                type="text"
                className="form-input"
                placeholder="Contoh: Token listrik, plastik kresek..."
                value={description}
                maxLength={200}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                minHeight: '48px',
                padding: '0 var(--space-6)',
                whiteSpace: 'nowrap',
                fontWeight: 'var(--weight-bold)',
              }}
            >
              {saving
                ? <><Loader2 size={16} className="spin-icon" aria-hidden="true" /> Menyimpan...</>
                : <><Plus size={16} aria-hidden="true" /> Simpan Biaya</>}
            </button>
          </div>
        </form>
        )}

        {formError && <div style={noticeStyle('error')} role="alert">{formError}</div>}
        {formOk && <div style={noticeStyle('success')} role="status">{formOk}</div>}

        {/* ── Daftar ── */}
        {listError && <div style={noticeStyle('error')} role="alert">{listError}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 'var(--space-4)' }}>
            <Loader2 size={18} className="spin-icon" aria-hidden="true" />
          </div>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', margin: 0 }}>
            Belum ada biaya tercatat pada periode ini.
          </p>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 38, textAlign: 'center' }}>
                      <SelectAllCheckbox
                        checked={selection.allVisibleSelected(visibleIds)}
                        indeterminate={selection.someVisibleSelected(visibleIds)}
                        onChange={() => selection.toggleAll(visibleIds)}
                        ariaLabel="Pilih semua biaya terlihat"
                      />
                    </th>
                    <th scope="col">Tanggal</th>
                    <th scope="col">Kategori</th>
                    <th scope="col">Keterangan</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Nominal</th>
                    <th scope="col">Dicatat oleh</th>
                    <th scope="col"><span className="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const checked = selection.isSelected(r.id);
                    return (
                      <tr
                        key={r.id}
                        style={{
                          backgroundColor: checked ? 'hsl(38 92% 96% / 0.7)' : undefined,
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => selection.toggleRow(r.id)}
                            aria-label={`Pilih biaya ${r.description} (${formatTanggalWib(r.expenseDate)})`}
                            style={{
                              width: 16,
                              height: 16,
                              cursor: 'pointer',
                              accentColor: 'var(--color-primary)',
                              verticalAlign: 'middle',
                            }}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatTanggalWib(r.expenseDate)}</td>
                        <td>{EXPENSE_CATEGORY_LABEL[r.category]}</td>
                        <td className="allow-wrap">
                          {r.description}
                          {deleteId === r.id && (
                            <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                              <label htmlFor={`${uid}-del-${r.id}`} className="form-label" style={{ margin: 0 }}>
                                Alasan menghapus (min. 5 karakter)
                              </label>
                              <input
                                id={`${uid}-del-${r.id}`}
                                type="text"
                                className="form-input"
                                value={deleteReason}
                                maxLength={200}
                                onChange={(e) => { setDeleteReason(e.target.value); setDeleteError(''); }}
                                autoFocus
                              />
                              {deleteError && <span role="alert" style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>{deleteError}</span>}
                              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={deleting}
                                  onClick={() => void handleDelete(r.id)}
                                >
                                  {deleting ? 'Menghapus...' : 'Konfirmasi Hapus'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={deleting}
                                  onClick={() => { setDeleteId(null); setDeleteReason(''); setDeleteError(''); }}
                                >
                                  Batal
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="text-right" style={{ fontWeight: 'var(--weight-semibold)' }}>{formatRupiah(r.amount)}</td>
                        <td>{r.createdByName}</td>
                        <td>
                          {deleteId !== r.id && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => { setDeleteId(r.id); setDeleteReason(''); setDeleteError(''); }}
                              aria-label={`Hapus biaya ${r.description}`}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: 'var(--color-surface-alt)', fontWeight: 'var(--weight-bold)' }}>
                    <td colSpan={4} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      TOTAL ({rows.length} biaya)
                    </td>
                    <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {formatRupiah(total)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            <SelectedRowsBar
              selectedCount={selectedRows.length}
              itemLabel="item biaya"
              metrics={[
                { label: 'Total Biaya Terpilih', value: formatRupiah(selectedTotal), tone: 'warning' },
                {
                  label: 'Rata-rata / Item',
                  value: formatRupiah(selectedRows.length > 0 ? Math.round(selectedTotal / selectedRows.length) : 0),
                  tone: 'default',
                },
                {
                  label: 'Kategori',
                  value: `${new Set(selectedRows.map((r) => r.category)).size} jenis`,
                  tone: 'info',
                },
              ]}
              onExportExcel={handleExportSelected}
              onClear={selection.clearSelection}
            />
          </>
        )}

        {truncated && (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
            Menampilkan 1.000 biaya terbaru.
          </p>
        )}

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-surface-alt)',
            border: '1px solid var(--color-border)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <strong>Catatan Biaya Paten Operasional:</strong> Selain biaya yang tercatat di tabel di atas, laporan laba/rugi dan
          kartu KPI <em>Biaya Operasional</em> otomatis menyertakan alokasi paten <strong>Rp 50.000 / bulan operasional</strong>{' '}
          (Bensin/Transport Rp 30.000 + ATK Rp 20.000) yang dibagi rata ke hari operasional aktif pada bulan tersebut.
        </div>
      </div>
    </section>
  );
}
