import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/admin/laporan/per-shift/route';
import { signAccessToken } from '../src/lib/utils/auth';

const HARI_ORDER: Record<string, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
  Minggu: 7,
};

async function simulateFrontendGroups(monthStr: string) {
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
  const json = await res.json();
  const data = json.data;

  console.log(`\n======================================================`);
  console.log(`SIMULASI KELOMPOK FRONTEND UNTUK BULAN ${monthStr}`);
  console.log(`======================================================`);

  // Logika persis seperti RekapShift.tsx:
  const sessionMap = new Map<string, any>();
  for (const s of data.shifts) {
    const sKey = `${s.tanggal}-${s.sesi}`;
    const gaji = s.gajiBersih !== undefined ? s.gajiBersih : (s.personnelCount > 0 ? s.poolGaji : 0);
    const existing = sessionMap.get(sKey);
    if (!existing) {
      sessionMap.set(sKey, {
        sessionKey: sKey,
        tanggal: s.tanggal,
        hari: s.hari,
        sesi: s.sesi,
        slotLabel: s.slotLabel,
        kasirName: s.kasirName,
        txCount: s.txCount,
        omzet: s.omzet,
        labaKotor: s.labaKotor,
        upahBersih: gaji,
        personnel: [...s.personnel],
      });
    } else {
      existing.txCount += s.txCount;
      existing.omzet += s.omzet;
      existing.labaKotor += s.labaKotor;
      existing.upahBersih += gaji;
      for (const p of s.personnel) {
        if (!existing.personnel.some((x: any) => x.employeeId === p.employeeId)) {
          existing.personnel.push(p);
        }
      }
    }
  }

  const groupMap = new Map<string, any>();
  for (const sess of sessionMap.values()) {
    const gKey = `${sess.hari}-${sess.sesi}`;
    const g = groupMap.get(gKey) ?? {
      hari: sess.hari,
      sesi: sess.sesi,
      sessions: [],
    };
    g.sessions.push(sess);
    groupMap.set(gKey, g);
  }

  const scheduleTeams = data.scheduleTeams ?? {};
  const builtGroups: any[] = [];

  for (const [gKey, g] of groupMap.entries()) {
    g.sessions.sort((a: any, b: any) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));

    // Anggota Shift:
    // Cek apakah ada personel aktual yang bertugas pada sesi-sesi tersebut
    const actualMembersMap = new Map<string, any>();
    for (const sess of g.sessions) {
      for (const p of sess.personnel) {
        if (!actualMembersMap.has(p.employeeId)) {
          actualMembersMap.set(p.employeeId, {
            employeeId: p.employeeId,
            fullName: p.fullName,
            nim: p.nim,
            jabatan: p.jabatan,
          });
        }
      }
    }

    // Scheduled members
    const scheduled = scheduleTeams[gKey] ?? [];

    builtGroups.push({
      groupKey: gKey,
      hari: g.hari,
      sesi: g.sesi,
      sessionsCount: g.sessions.length,
      dates: g.sessions.map((s: any) => s.tanggal),
      actualPersonnel: Array.from(actualMembersMap.values()).map(p => p.fullName),
      scheduledPersonnel: scheduled.map((s: any) => s.fullName),
      upahBersih: g.sessions.reduce((s: number, x: any) => s + x.upahBersih, 0),
      totalOmzet: g.sessions.reduce((s: number, x: any) => s + x.omzet, 0),
    });
  }

  builtGroups.sort((a, b) => {
    const dDiff = (HARI_ORDER[a.hari] ?? 9) - (HARI_ORDER[b.hari] ?? 9);
    if (dDiff !== 0) return dDiff;
    return a.sesi === 'Pagi' ? -1 : 1;
  });

  console.log(`Jumlah Kelompok Shift Aktif: ${builtGroups.length}`);
  builtGroups.forEach(bg => {
    console.log(`  [${bg.hari} - ${bg.sesi}] (${bg.sessionsCount}x shift: ${bg.dates.join(', ')})`);
    console.log(`    Personel Aktual Bertugas:`, bg.actualPersonnel);
    console.log(`    Personel Jadwal Master  :`, bg.scheduledPersonnel);
    console.log(`    Omzet: Rp ${bg.totalOmzet.toLocaleString('id-ID')} | Upah Bersih: Rp ${bg.upahBersih.toLocaleString('id-ID')}`);
  });
}

async function main() {
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    await simulateFrontendGroups(m);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
