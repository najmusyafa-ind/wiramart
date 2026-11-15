import type { Metadata } from 'next';
import { requireAdminShiftActor } from '@/features/portal/server-auth';
import { getShiftDashboardData } from '@/features/portal/dashboard/dashboard-data';
import AdminShiftDashboard from '@/features/portal/dashboard/AdminShiftDashboard';

export const metadata: Metadata = { title: 'Dashboard Admin Shift' };
export const revalidate = 60;

export default async function AdminDashboardPage() {
  const actor = await requireAdminShiftActor();
  const shiftData = await getShiftDashboardData();

  return (
    <AdminShiftDashboard
      adminName={actor.adminName}
      todayLabel={shiftData.todayLabel}
      summary={{
        activeShifts: shiftData.activeShifts,
        totalEmployees: shiftData.totalEmployees,
        pendingSwaps: shiftData.pendingSwaps,
        criticalBatches: shiftData.criticalBatches,
        pendingStockReceives: shiftData.pendingStockReceives,
        pendingConditionReports: shiftData.pendingConditionReports,
        lowStockProducts: shiftData.lowStockProducts,
        outOfStockProducts: shiftData.outOfStockProducts,
        lowStockThreshold: shiftData.lowStockThreshold,
        pettyCashOut: shiftData.pettyCashOut,
        pettyCashIn: shiftData.pettyCashIn,
        todayTransactions: shiftData.todayTransactions,
      }}
    />
  );
}
