// =============================================================
// Wiramart v2.0 — /order/profile (Server Component Entry)
// Membaca sesi buyer (sk_buyer) & riwayat pesanan secara aman (IDOR-safe).
// =============================================================

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getBuyerSession } from '@/lib/utils/auth';
import { getActiveBuyerProfile } from '@/features/order/buyer.service';
import { getOrdersByBuyerId } from '@/features/order/order.service';
import ProfileClient, { type BuyerOrderSummary } from './ProfileClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Akun & Pesanan | Wiramart Delivery',
};

export default async function BuyerProfilePage() {
  const session = await getBuyerSession();
  if (!session) {
    redirect('/order/login?next=/order/profile');
  }

  // Pastikan akun buyer masih ada & aktif di database (bukan sekadar cookie JWT basi setelah akun dihapus)
  const profile = await getActiveBuyerProfile(session.sub);
  if (!profile) {
    redirect('/order/login?next=/order/profile');
  }

  let initialOrders: BuyerOrderSummary[] = [];
  try {
    const rows = await getOrdersByBuyerId(profile.id, 15);
    initialOrders = rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      deliveryType: row.deliveryType,
      deliveryFloor: row.deliveryFloor,
      roomDetail: row.roomDetail,
      paymentMethod: row.paymentMethod,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error('[BuyerProfilePage] Gagal mengambil riwayat pesanan:', err);
  }

  return (
    <ProfileClient
      initialBuyer={{
        id: profile.id,
        fullName: profile.name,
        nim: profile.nim,
      }}
      initialOrders={initialOrders}
    />
  );
}

