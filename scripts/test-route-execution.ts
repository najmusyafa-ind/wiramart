import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/admin/laporan/per-shift/route';
import { signAccessToken } from '../src/lib/utils/auth';

async function testRouteMonth(monthStr: string) {
  const token = await signAccessToken({
    sub: 'admin-1',
    role: 'admin',
    adminRole: 'MANAGER',
    email: 'dosen@unperba.ac.id',
  });

  const url = `http://localhost:3000/api/admin/laporan/per-shift?month=${monthStr}`;
  const req = new NextRequest(url, {
    headers: {
      cookie: `sk_admin=${token}`,
    },
  });

  const res = await GET(req);
  const data = await res.json();
  console.log(`\n======================================================`);
  console.log(`TEST API ROUTE: month=${monthStr}`);
  console.log(`Status HTTP: ${res.status}`);
  if (!data.success) {
    console.error(`Error:`, data.error);
    return null;
  }
  console.log(`Success! Label: ${data.data.range.label}`);
  console.log(`Grand Total Omzet: Rp ${data.data.grandTotal.omzet?.toLocaleString('id-ID')}`);
  console.log(`Grand Total Laba Kotor: Rp ${data.data.grandTotal.labaKotor?.toLocaleString('id-ID')}`);
  console.log(`Grand Total Pool Mhs (50%): Rp ${data.data.grandTotal.poolShiftMahasiswa?.toLocaleString('id-ID')}`);
  console.log(`Grand Total Kas Toko (50%): Rp ${data.data.grandTotal.labaBersihToko?.toLocaleString('id-ID')}`);
  console.log(`Total Shifts: ${data.data.shifts.length}`);
  console.log(`Total Summary Employees: ${data.data.summaryPerEmployee.length}`);

  return data.data;
}

async function main() {
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    await testRouteMonth(m);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
