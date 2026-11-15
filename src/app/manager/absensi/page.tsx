import type { Metadata } from 'next';
import AbsensiPageClient from '@/features/portal/absensi/AbsensiPageClient';

export const metadata: Metadata = { title: 'Absensi & Kedisiplinan' };

export default function ManagerAbsensiPage() {
  return <AbsensiPageClient />;
}

