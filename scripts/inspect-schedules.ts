import { db } from '../src/lib/db/client';
import { shiftSchedules, employees } from '../src/lib/db/schema';
import { asc, eq } from 'drizzle-orm';

async function main() {
  const list = await db
    .select({
      id: shiftSchedules.id,
      dayOfWeek: shiftSchedules.dayOfWeek,
      slotStart: shiftSchedules.slotStart,
      slotEnd: shiftSchedules.slotEnd,
      orderInSlot: shiftSchedules.orderInSlot,
      employeeId: shiftSchedules.employeeId,
      empName: employees.fullName,
      empNim: employees.nim,
      empJabatan: employees.jabatan,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .orderBy(asc(shiftSchedules.dayOfWeek), asc(shiftSchedules.slotStart), asc(shiftSchedules.orderInSlot));

  console.log(`Total shift schedules: ${list.length}`);
  for (const s of list) {
    console.log(`[${s.dayOfWeek}] ${s.slotStart}-${s.slotEnd} #${s.orderInSlot}: ${s.empName ?? 'KOSONG'} (${s.empNim ?? '-'}) [Jabatan: ${s.empJabatan ?? '-'}]`);
  }
}

main().catch(console.error);
