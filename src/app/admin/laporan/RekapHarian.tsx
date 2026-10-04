'use client';

import { CalendarDays } from 'lucide-react';
import { formatRupiah, formatTanggalWib, type DailyRowUi } from './shared';

type Props = {
  rows: DailyRowUi[];
  /** false → laba kotor tidak lengkap (ada produk tanpa HPP): beri penanda pada kolom laba. */
  labaLengkap: boolean;
};

type Totals = Omit<DailyRowUi, 'date'>;

function sumRows(rows: DailyRowUi[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      txCount: acc.txCount + r.txCount,
      voidCount: acc.voidCount + r.voidCount,
      omzet: acc.omzet + r.omzet,
      omzetCash: acc.omzetCash + r.omzetCash,
      omzetQris: acc.omzetQris + r.omzetQris,
      hppTerjual: acc.hppTerjual + r.hppTerjual,
      labaKotor: acc.labaKotor + r.labaKotor,
      omzetTanpaHpp: acc.omzetTanpaHpp + r.omzetTanpaHpp,
      biayaOperasional: acc.biayaOperasional + r.biayaOperasional,
      labaBersih: acc.labaBersih + r.labaBersih,
    }),
    {
      txCount: 0, voidCount: 0, omzet: 0, omzetCash: 0, omzetQris: 0, hppTerjual: 0,
      labaKotor: 0, omzetTanpaHpp: 0, biayaOperasional: 0, labaBersih: 0,
    },
  );
}

function profitColor(n: number): string {
  if (n < 0) return 'var(--color-error)';
  if (n > 0) return 'var(--color-success)';
  return 'var(--color-text-muted)';
}

export default function RekapHarian({ rows, labaLengkap }: Props) {
  const totals = sumRows(rows);
  const mark = labaLengkap ? '' : '*';

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }} aria-labelledby="rekap-harian-title">
      <div className="card-header">
        <h2
          id="rekap-harian-title"
          className="card-title"
          style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <CalendarDays size={16} aria-hidden="true" /> Rekap Harian
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="card-body">
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
            Belum ada transaksi atau biaya pada periode ini.
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table" style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
            <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Rekap omzet, laba, dan biaya per hari (zona waktu WIB)
            </caption>
            <thead>
              <tr>
                <th scope="col">Tanggal</th>
                <th scope="col" style={{ textAlign: 'right' }}>Trx</th>
                <th scope="col" style={{ textAlign: 'right' }}>Void</th>
                <th scope="col" style={{ textAlign: 'right' }}>Omzet</th>
                <th scope="col" style={{ textAlign: 'right' }}>Cash</th>
                <th scope="col" style={{ textAlign: 'right' }}>QRIS</th>
                <th scope="col" style={{ textAlign: 'right' }}>HPP</th>
                <th scope="col" style={{ textAlign: 'right' }}>Laba Kotor{mark}</th>
                <th scope="col" style={{ textAlign: 'right' }}>Biaya</th>
                <th scope="col" style={{ textAlign: 'right' }}>Laba Bersih{mark}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
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
                  <td className="text-right">{formatRupiah(r.biayaOperasional)}</td>
                  <td
                    className="text-right"
                    style={{ color: profitColor(r.labaBersih), fontWeight: 'var(--weight-bold)' }}
                  >
                    {formatRupiah(r.labaBersih)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--color-surface-alt)', fontWeight: 'var(--weight-bold)' }}>
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>TOTAL ({rows.length} hari)</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{totals.txCount}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{totals.voidCount}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzet)}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzetCash)}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.omzetQris)}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.hppTerjual)}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)', color: profitColor(totals.labaKotor) }}>
                  {formatRupiah(totals.labaKotor)}
                </td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)' }}>{formatRupiah(totals.biayaOperasional)}</td>
                <td className="text-right" style={{ padding: 'var(--space-3) var(--space-4)', color: profitColor(totals.labaBersih) }}>
                  {formatRupiah(totals.labaBersih)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
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
