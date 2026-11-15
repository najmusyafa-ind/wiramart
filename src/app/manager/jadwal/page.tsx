import type { Metadata } from 'next';
import JadwalPageClient from '@/features/portal/jadwal/JadwalPageClient';

export const metadata: Metadata = { title: 'Jadwal Shift' };

export default function ManagerJadwalPage() {
  return <JadwalPageClient />;
}

