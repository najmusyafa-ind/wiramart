import { redirect } from 'next/navigation';

/**
 * Menu terpisah "Rekonsiliasi QRIS" kini dilebur ke halaman Laporan -> Tab "Transaksi & QRIS"
 * (Cek Cepat QRIS Bu Dyah per hari & per jam). Redirect permanen agar tautan lama tidak 404.
 */
export default function LegacyQrisRedirectPage() {
  redirect('/manager/laporan?tab=transaksi_qris');
}
