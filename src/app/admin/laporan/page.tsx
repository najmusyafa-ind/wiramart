import { redirect } from 'next/navigation';
import { ADMIN_DASHBOARD_PATH } from '@/lib/utils/routes';

export default function LegacyAdminLaporanRedirect() {
  redirect(ADMIN_DASHBOARD_PATH);
}

