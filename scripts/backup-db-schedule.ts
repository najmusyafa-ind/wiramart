import { db } from '../src/lib/db/client';
import { employees, admins, shiftSchedules } from '../src/lib/db/schema';
import * as fs from 'fs';
import * as path from 'path';

async function backup() {
  const emp = await db.query.employees.findMany();
  const adm = await db.query.admins.findMany();
  const sch = await db.query.shiftSchedules.findMany();

  const backupData = {
    timestamp: new Date().toISOString(),
    employeesCount: emp.length,
    adminsCount: adm.length,
    schedulesCount: sch.length,
    employees: emp,
    admins: adm,
    schedules: sch,
  };

  const backupPath = path.join(process.cwd(), 'scripts', `backup-before-update-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`✅ Backup berhasil disimpan ke: ${backupPath}`);
  console.log(`- Employees: ${emp.length}`);
  console.log(`- Admins: ${adm.length}`);
  console.log(`- Schedules: ${sch.length}`);
}

backup().catch(console.error);
