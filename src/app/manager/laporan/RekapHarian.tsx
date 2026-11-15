'use client';

import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useTableSelection } from '@/hooks/useTableSelection';
import { SelectAllCheckbox, SelectedRowsBar } from '@/components/admin/SelectedRowsBar';
import { exportSelectedRowsToExcel, todayWibSlug } from '@/lib/utils/exportSelectedExcel';
import { formatRupiah, formatTanggalWib, type DailyRowUi } from '@/features/portal/laporan/shared';

type Props = {
  rows: DailyRowUi[];
  /** false → laba kotor tidak lengkap (ada produk tanpa HPP): beri penanda pada kolom laba. */
  labaLengkap: boolean;
};

type Totals = Omit<DailyRowUi, 'date'>;

function sumRows(rows: readonly DailyRowUi[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      txCount: acc.txCount + r.txCount,
      voidCount: acc.voidCount + r.voidCount,
      omzet: acc.omzet + r.omzet,
      omzetCash: acc.omzetCash + r.omzetCash,
      omzetQris: acc.omzetQris + r.omzetQris,
      hppTerjual: acc.hppTerjual + r.hppTerjual,
      labaKotor: acc.labaKotor + r.labaKotor,
      alokasiGajiKaryawan: acc.alokasiGajiKaryawan + (r.alokasiGajiKaryawan ?? Math.round(r.labaKotor * 0.5)),
      omzetTanpaHpp: acc.omzetTanpaHpp + r.omzetTanpaHpp,
      biayaOperasional: acc.biayaOperasional + r.biayaOperasional,
      labaBersih: acc.labaBersih + r.labaBersih,
    }),
    {
      txCount: 0, voidCount: 0, omzet: 0, omzetCash: 0, omzetQris: 0, hppTerjual: 0,
      labaKotor: 0, alokasiGajiKaryawan: 0, omzetTanpaHpp: 0, biayaOperasional: 0, labaBersih: 0,
    },
  );
}

function profitColor(n: number): string {
  if (n < 0) return 'var(--color-error)';
  if (n > 0) return 'var(--color-success)';
  return 'var(--color-text-muted)';
}

export default function RekapHarian({ rows, labaLengkap }: Props) {
  const selection = useTableSelection();
  const visibleIds = useMemo(() => rows.map((r) => r.date), [rows]);
  const selectedRows = useMemo(
    () => selection.getSelectedRows(rows, (r) => r.date),
    [selection, rows],
  );
  const totals = useMemo(() => sumRows(rows), [rows]);
  const selectedTotals = useMemo(() => sumRows(selectedRows), [selectedRows]);
  const mark = labaLengkap ? '' : '*';

  async function handleExportSelected(): Promise<void> {
    if (selectedRows.length === 0) return;
    await exportSelectedRowsToExcel({
      filename: `rekap-harian-terpilih-${todayWibSlug()}.xlsx`,
      sheetName: 'Rekap Harian Terpilih',
      title: `REKAP HARIAN TERPILIH (${selectedRows.length} Hari)`,
      subtitle: `Dicetak ${todayWibSlug()} WIB${!labaLengkap ? ' | * Sebagian produk belum memiliki HPP' : ''}`,
      rows: selectedRows,
      columns: [
        { header: 'Tanggal', key: 'date', width: 14, format: 'text', aggregate: 'none', value: (r) => r.date },
        { header: 'Hari / Tanggal', key: 'label', width: 22, format: 'text', aggregate: 'count', value: (r) => formatTanggalWib(r.date) },
        { header: 'Transaksi', key: 'txCount', width: 12, format: 'integer', aggregate: 'sum', value: (r) => r.txCount },
        { header: 'Void', key: 'voidCount', width: 10, format: 'integer', aggregate: 'sum', value: (r) => r.voidCount },
        { header: 'Omzet', key: 'omzet', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.omzet },
        { header: 'Cash', key: 'omzetCash', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.omzetCash },
        { header: 'QRIS', key: 'omzetQris', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.omzetQris },
        { header: 'HPP', key: 'hppTerjual', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.hppTerjual },
        { header: 'Laba Kotor', key: 'labaKotor', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.labaKotor },
        {
          header: 'Bagi Hasil 50% Mahasiswa',
          key: 'alokasiGajiKaryawan',
          width: 24,
          format: 'currency',
          aggregate: 'sum',
          value: (r) => r.alokasiGajiKaryawan ?? Math.round(r.labaKotor * 0.5),
        },
        { header: 'Biaya Operasional', key: 'biayaOperasional', width: 18, format: 'currency', aggregate: 'sum', value: (r) => r.biayaOperasional },
        { header: 'Laba Bersih Toko 50%', key: 'labaBersih', width: 22, format: 'currency', aggregate: 'sum', value: (r) => r.labaBersih },
      ],
    });
  }

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }} aria-labelledby="rekap-harian-title">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2
          id="rekap-harian-title"
          className="card-title"
          style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <CalendarDays size={16} aria-hidden="true" /> Rekap Harian
          {rows.length > 0 && (
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--weight-normal)', fontSize: 'var(--text-xs)' }}>
              ({rows.length} hari)
            </span>
          )}
        </h2>
        {rows.length > 0 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Centang baris tanggal untuk hitung subtotal &amp; ekspor Excel
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card-body">
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
            Belum ada transaksi atau biaya pada periode ini.
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="table" style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Rekap omzet, laba, bagi hasil karyawan, dan biaya per hari (zona waktu WIB)
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 38, textAlign: 'center' }}>
                    <SelectAllCheckbox
                      checked={selection.allVisibleSelected(visibleIds)}
                      indeterminate={selection.someVisibleSelected(visibleIds)}
                      onChange={() => selection.toggleAll(visibleIds)}
                      ariaLabel="Pilih semua hari terlihat"
                    />
                  </th>
                  <th scope="col">Tanggal</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Trx</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Void</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Omzet</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Cash</th>
                  <th scope="col" style={{ textAlign: 'right' }}>QRIS</th>
                  <th scope="col" style={{ textAlign: 'right' }}>HPP</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Laba Kotor{mark}</th>
                  <th scope="col" style={{ textAlign: 'right', color: 'var(--color-primary)' }}>Bagi Hasil (50%)</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Biaya</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Laba Bersih Toko{mark}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const checked = selection.isSelected(r.date);
                  return (
                    <tr
                      key={r.date}
                      style={{
                        backgroundColor: checked ? 'hsl(152 60% 96% / 0.7)' : undefined,
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => selection.toggleRow(r.date)}
                          aria-label={`Pilih rekap ${formatTanggalWib(r.date)}`}
                          style={{
                            width: 16,
                            height: 16,
                            cursor: 'pointer',
                            accentColor: 'var(--color-primary)',
                            verticalAlign: 'middle',
                          }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTanggalWib(r.date)}</td>
                      <td className="text-right">{r.txCount}</td>
                      <td
                        className="text-right"
                        style={{ color: r.voidCount > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}
                      >
                        {r.voidCount}
                      </td>
                      <td className="text-right" style={{ fontWeight: 'var(--weight-semibold)' }}>{formatRupiah(r.omzet)}</td>
                      <td className="text-right">{formatRupiah(r.omzetCash)}</td>
                      <td className="text-right">{formatRupiah(r.omzetQris)}</td>
                      <td className="text-right">{formatRupiah(r.hppTerjual)}</td>
                      <td className="text-right" style={{ color: profitColor(r.labaKotor) }}>{formatRupiah(r.labaKotor)}</td>
                      <td className="text-right" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-medium)' }}>
                        {formatRupiah(r.alokasiGajiKaryawan ?? Math.round(r.labaKotor * 0.5))}
                      </td>
                      <td className="text-right">{formatRupiah(r.biayaOperasional)}</td>
                      <td
                        className="text-right"
                        style={{ color: profitColor(r.labaBersih), fontWeight: 'var(--weight-bold)' }}
                      >
                        {formatRupiah(r.labaBersih)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: 'var(--color-surface-alt)', fontWeight: 'var(--weight-bold)' }}>
                  <td colSpan={2} style={{ padding: 'var(--space-3) var(--space-4)' }}>TOTAL ({rows.length} hari)</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{totals.txCount}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{totals.voidCount}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzet)}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzetCash)}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzetQris)}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.hppTerjual)}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)', color: profitColor(totals.labaKotor) }}>
                    {formatRupiah(totals.labaKotor)}
                  </td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-primary)' }}>
                    {formatRupiah(totals.alokasiGajiKaryawan)}
                  </td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.biayaOperasional)}</td>
                  <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)', color: profitColor(totals.labaBersih) }}>
                    {formatRupiah(totals.labaBersih)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <SelectedRowsBar
            selectedCount={selectedRows.length}
            itemLabel="hari"
            metrics={[
              { label: 'Omzet', value: formatRupiah(selectedTotals.omzet), tone: 'default' },
              { label: 'Cash', value: formatRupiah(selectedTotals.omzetCash), tone: 'info' },
              { label: 'QRIS', value: formatRupiah(selectedTotals.omzetQris), tone: 'info' },
              { label: 'HPP', value: formatRupiah(selectedTotals.hppTerjual), tone: 'default' },
              {
                label: 'Laba Kotor',
                value: formatRupiah(selectedTotals.labaKotor),
                tone: selectedTotals.labaKotor >= 0 ? 'success' : 'danger',
              },
              { label: '50% Mahasiswa', value: formatRupiah(selectedTotals.alokasiGajiKaryawan), tone: 'primary' },
              { label: 'Biaya', value: formatRupiah(selectedTotals.biayaOperasional), tone: 'warning' },
              {
                label: '50% Wiramart',
                value: formatRupiah(selectedTotals.labaBersih),
                tone: selectedTotals.labaBersih >= 0 ? 'success' : 'danger',
              },
            ]}
            onExportExcel={handleExportSelected}
            onClear={selection.clearSelection}
          />
        </>
      )}

      {!labaLengkap && rows.length > 0 && (
        <p
          style={{
            margin: 0,
            padding: 'var(--space-3) var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          * Laba belum lengkap: penjualan produk yang HPP-nya belum diisi tidak ikut dihitung dalam laba.
        </p>
      )}
    </section>
  );
}
