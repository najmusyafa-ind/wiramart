import type { Metadata } from 'next';
import KaryawanPageClient from '@/features/portal/karyawan/KaryawanPageClient';

export const metadata: Metadata = { title: 'Karyawan' };

export default function ManagerKaryawanPage() {
  return <KaryawanPageClient />;
}

