import type { Metadata } from 'next';
import SwapRequestPageClient from '@/features/portal/swap-request/SwapRequestPageClient';

export const metadata: Metadata = { title: 'Riwayat Tukar Shift' };

export default function AdminSwapRequestPage() {
  return <SwapRequestPageClient />;
}

