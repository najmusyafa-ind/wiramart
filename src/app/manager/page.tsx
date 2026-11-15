import { redirect } from 'next/navigation';
import { MANAGER_DASHBOARD_PATH } from '@/lib/utils/routes';

export default function ManagerRootPage() {
  redirect(MANAGER_DASHBOARD_PATH);
}

