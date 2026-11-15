import { redirect } from 'next/navigation';

export default function LegacyKasirGudangLoginRedirect() {
  redirect('/gudang/login');
}

