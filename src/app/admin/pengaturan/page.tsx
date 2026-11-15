import { redirect } from 'next/navigation';
import { ADMIN_DASHBOARD_PATH } from '@/lib/utils/routes';

export default function LegacyAdminPengaturanRedirect() {
  redirect(ADMIN_DASHBOARD_PATH);
}

