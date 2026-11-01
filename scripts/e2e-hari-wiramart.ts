/**
 * E2E "Hari Operasional Wiramart" — STAGING ONLY.
 *
 * Alur (sesuai SOP): absen masuk → (admin edit stok) → buka shift → transaksi
 *   → kasir cek riwayat sendiri → tutup shift → absen pulang → GANTI SHIFT
 *   → kasir #2: buka shift → transaksi → tutup shift (sengaja kurang Rp 5.000)
 *   → manager: laporan penjualan + selisih laci + jejak transaksi (TCL).
 *
 * Verifikasi memakai ORACLE SQL independen (bukan kode route yang diuji).
 * Semua data uji dibersihkan di blok finally; stok & batch dikembalikan persis.
 *
 * Jalankan (dev server harus hidup di :3000, env = staging):
 *   npx tsx --env-file=.env.local scripts/e2e-hari-wiramart.ts
 * Opsional langkah admin lewat HTTP asli (kredensial staging milik Anda):
 *   E2E_ADMIN_NIDN=... E2E_ADMIN_PASSWORD=... npx tsx --env-file=.env.local scripts/e2e-hari-wiramart.ts
 */
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { getFinancialReport, resolveReportRange } from '../src/lib/finance/report';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL ?? '';
if (!DB_URL.includes('ivnikcqmnhtlnfhxtekn')) {
  throw new Error('GUARD: E2E hanya boleh berjalan di STAGING (ivnikcqm…). Dibatalkan.');
}
const sql = postgres(DB_URL, { max: 3 });

type Row = { step: string; ok: boolean | 'SKIP'; note: string };
const results: Row[] = [];
const check = (step: string, ok: boolean, note = '') => {
  results.push({ step, ok, note });
  console.log(`${ok ? '✅' : '❌'} ${step}${note ? ' — ' + note : ''}`);
};
const skip = (step: string, note: string) => {
  results.push({ step, ok: 'SKIP', note });
  console.log(`⏭️  ${step} — ${note}`);
};

// ── HTTP helper: cookie jar sederhana ────────────────────────
async function http(method: string, path: string, cookie: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, headers: res.headers };
}
/** Ambil nilai bersarang dari JSON `unknown` tanpa cast liar: at<string>(j, 'data.shiftId'). */
function at<T>(obj: unknown, path: string): T | undefined {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as T | undefined;
}
const firstArray = <T>(obj: unknown, ...paths: string[]): T[] => {
  for (const p of paths) { const v = at<unknown>(obj, p); if (Array.isArray(v)) return v as T[]; }
  return [];
};
type TxRow = { grossAmount?: string | number };
type ShiftDetail = { shiftId: string; discrepancy?: number | null };
type LogApiRow = { employeeId: string; outcome: string };
const cookieFrom = (h: Headers, name: string) =>
  h.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '=')) ?? '';

const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const num = (v: unknown) => Number(v ?? 0);

// ── Snapshot untuk cleanup ───────────────────────────────────
const startedAt = new Date();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(startedAt);
const created = { txIds: [] as string[], shiftIds: [] as string[], attIds: [] as string[] };
let snapProducts: Array<{ id: string; stock_qty: number }> = [];
let snapBatches: Array<{ id: string; current_qty: number }> = [];
let snapJabatan: Array<{ id: string; jabatan: string }> = [];

type Emp = { id: string; nim: string; full_name: string; jabatan: string };
type Prod = { id: string; name: string; selling_price: string; cost_price: string; stock_qty: number };

async function kasirDay(opts: {
  label: string; emp: Emp; prods: [Prod, Prod]; shortage: number;
  txPlan: Array<{ items: Array<{ p: 0 | 1; qty: number }>; pay: 'CASH' | 'QRIS' | 'SPLIT' }>;
}) {
  const { label, emp, prods, shortage, txPlan } = opts;
  console.log(`\n══════ ${label}: ${emp.full_name} (${emp.nim}) ══════`);

  // 1. ABSEN MASUK (login NIM → sistem mencatat presensi otomatis)
  const login = await http('POST', '/api/auth/kasir', '', { nim: emp.nim, fullName: emp.full_name });
  const ck = cookieFrom(login.headers, 'sk_kasir');
  check(`${label} · login kasir`, login.status === 200 && !!ck, `HTTP ${login.status}`);
  if (!ck) throw new Error('login gagal');
  const [att] = await sql`SELECT id, schedule_id, status, clock_in_actual FROM attendances
                          WHERE employee_id=${emp.id} AND attendance_date=${today}`;
  check(`${label} · absen masuk tercatat`, !!att, att ? `status=${att.status}` : 'tidak ada baris attendances (jadwal hari ini kosong?)');
  if (att) created.attIds.push(att.id);

  // 2. BUKA SHIFT
  const buka = await http('PATCH', '/api/kasir/shift/buka', ck, { modalAwal: 100000 });
  const shiftId = at<string>(buka.json, 'data.shiftId') ?? '';
  check(`${label} · buka shift (modal Rp 100.000)`, buka.status === 200 && !!shiftId, `HTTP ${buka.status}`);
  if (shiftId) created.shiftIds.push(shiftId);

  // 3. TRANSAKSI
  let cashSales = 0, omzet = 0, committed = 0;
  const soldQty = [0, 0];
  const txIds: string[] = [];
  for (const [i, plan] of txPlan.entries()) {
    const items = plan.items.map((x) => ({ productId: prods[x.p].id, qty: x.qty }));
    const total = plan.items.reduce((s, x) => s + num(prods[x.p].selling_price) * x.qty, 0);
    const body = plan.pay === 'SPLIT'
      ? { items, payments: [
          { paymentMethod: 'CASH', amount: Math.floor(total / 2), cashReceived: Math.floor(total / 2) + 5000 },
          { paymentMethod: 'QRIS', amount: total - Math.floor(total / 2) },
        ] }
      : plan.pay === 'CASH'
        ? { items, paymentMethod: 'CASH', cashReceived: Math.ceil(total / 5000) * 5000 + 5000 }
        : { items, paymentMethod: 'QRIS' };
    const key = 'e2e' + randomUUID().replace(/-/g, '').slice(0, 24);
    const r = await http('POST', '/api/kasir/transaksi', ck, body, { 'idempotency-key': key });
    const txId = at<string>(r.json, 'data.transactionId');
    check(`${label} · transaksi #${i + 1} (${plan.pay}, ${rupiah(total)})`, r.status === 201 && !!txId, `HTTP ${r.status}`);
    if (!txId) continue;
    committed++; omzet += total; txIds.push(txId); created.txIds.push(txId);
    plan.items.forEach((x) => (soldQty[x.p] += x.qty));
    cashSales += plan.pay === 'CASH' ? total : plan.pay === 'SPLIT' ? Math.floor(total / 2) : 0;
    if (i === 0) { // idempotency: kirim ulang kunci yang sama → replay, bukan transaksi ganda
      const again = await http('POST', '/api/kasir/transaksi', ck, body, { 'idempotency-key': key });
      check(`${label} · kirim ulang (klik ganda) tidak membuat transaksi baru`,
        again.status === 200 && at<boolean>(again.json, 'data.replayed') === true && at<string>(again.json, 'data.transactionId') === txId, `HTTP ${again.status}`);
    }
  }
  // Penolakan pra-transaksi (stok tidak cukup) → harus REJECTED + stok tak berubah
  const rej = await http('POST', '/api/kasir/transaksi', ck, { items: [{ productId: prods[0].id, qty: 999999 }], paymentMethod: 'QRIS' });
  check(`${label} · transaksi stok kurang ditolak`, rej.status === 400, `HTTP ${rej.status}`);

  // 4. JEJAK TCL di DB (bukti START/COMMIT/REJECT)
  const logs = await sql`SELECT outcome, created_at, finished_at, transaction_id, failed_step
                         FROM transaction_logs WHERE employee_id=${emp.id} AND created_at >= ${startedAt}`;
  const cnt = (o: string) => logs.filter((l) => l.outcome === o).length;
  check(`${label} · log COMMITTED = jumlah transaksi sukses`, cnt('COMMITTED') === committed, `${cnt('COMMITTED')}/${committed}`);
  check(`${label} · log REJECTED tercatat`, cnt('REJECTED') >= 1, `${cnt('REJECTED')}`);
  check(`${label} · tidak ada log STARTED menggantung`, cnt('STARTED') === 0, `${cnt('STARTED')}`);
  check(`${label} · setiap COMMITTED menunjuk transaksi nyata & finished_at ≥ created_at`,
    logs.filter((l) => l.outcome === 'COMMITTED').every((l) => txIds.includes(l.transaction_id) && l.finished_at >= l.created_at));

  // 5. RIWAYAT KASIR — transaksi dari localhost bertanda is_test=true (isolasi sandbox) → harus 0
  const rw0 = await http('GET', '/api/kasir/riwayat', ck);
  check(`${label} · sandbox: transaksi localhost TIDAK bocor ke riwayat`,
    rw0.status === 200 && firstArray<TxRow>(rw0.json, 'data.transaksi', 'data.transactions', 'data.riwayat').length === 0,
    `HTTP ${rw0.status}`);
  // Agar jalur laporan/riwayat/selisih bisa diuji, tandai transaksi uji ini non-test (HANYA di staging, dihapus di cleanup)
  await sql`UPDATE transactions SET is_test=false WHERE id = ANY(${txIds})`;
  const rw = await http('GET', '/api/kasir/riwayat', ck);
  const list = firstArray<TxRow>(rw.json, 'data.transaksi', 'data.transactions', 'data.riwayat');
  check(`${label} · riwayat kasir menampilkan ${committed} transaksi miliknya`, list.length === committed, `dapat ${list.length}`);
  check(`${label} · total riwayat = total omzet`,
    Math.abs(list.reduce((s, t) => s + num(t.grossAmount), 0) - omzet) < 0.01, rupiah(omzet));

  // 6. TUTUP SHIFT (blind count): fisik = modal + tunai − shortage
  const actual = 100000 + cashSales - shortage;
  const tutup = await http('PATCH', '/api/kasir/shift/tutup', ck, { actualCash: actual });
  check(`${label} · tutup shift`, tutup.status === 200 && at<number>(tutup.json, 'data.txCount') === committed, `HTTP ${tutup.status}, txCount=${at<number>(tutup.json, 'data.txCount')}`);

  // 7. ABSEN PULANG
  if (att) {
    const out = await http('POST', '/api/kasir/presensi', '', { action: 'CLOCK_OUT', employeeId: emp.id, scheduleId: att.schedule_id });
    check(`${label} · absen pulang`, out.status === 200, `HTTP ${out.status}`);
  }
  return { shiftId, omzet, cashSales, actual, committed, soldQty, txIds };
}

async function main() {
  const h = await fetch(BASE + '/api/health').catch(() => null);
  if (!h) throw new Error(`Dev server tidak hidup di ${BASE}. Jalankan: npm run dev`);

  // Kandidat: karyawan terjadwal HARI INI, bukan akun testing/dummy, belum punya presensi/shift hari ini
  const hari = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long' }).format(startedAt).toUpperCase();
  const emps = await sql<Emp[]>`
    SELECT DISTINCT ON (e.id) e.id, e.nim, e.full_name, e.jabatan, s.slot_start
    FROM employees e JOIN shift_schedules s ON s.employee_id=e.id AND s.is_active AND s.day_of_week=${hari}
    WHERE e.is_active AND e.deleted_at IS NULL
      AND lower(e.full_name) NOT LIKE '%testing%' AND lower(e.full_name) NOT LIKE '%dede%'
      AND e.nim NOT IN ('02405013','00000000')
      AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.employee_id=e.id AND a.attendance_date=${today})
      AND NOT EXISTS (SELECT 1 FROM shifts sh WHERE sh.employee_id=e.id AND sh.status='ACTIVE')
    ORDER BY e.id, s.slot_start LIMIT 20`;
  if (emps.length < 2) throw new Error(`Butuh ≥2 karyawan terjadwal ${hari} di staging; ketemu ${emps.length}`);
  const [A, B] = emps as [Emp, Emp];
  snapJabatan = emps.slice(0, 2).map((e) => ({ id: e.id, jabatan: e.jabatan }));

  const prodRows = await sql<Prod[]>`
    SELECT id, name, selling_price, cost_price, stock_qty FROM products
    WHERE is_active AND deleted_at IS NULL AND stock_qty >= 40 AND cost_price > 0 AND selling_price >= cost_price
    ORDER BY stock_qty DESC LIMIT 2`;
  if (prodRows.length < 2) throw new Error('Butuh ≥2 produk aktif stok ≥ 40 di staging');
  const prods = prodRows as unknown as [Prod, Prod];
  const ids = prods.map((p) => p.id);
  snapProducts = await sql`SELECT id, stock_qty FROM products WHERE id = ANY(${ids})`;
  snapBatches = await sql`SELECT id, current_qty FROM stock_batches WHERE product_id = ANY(${ids})`;
  console.log(`Hari: ${hari} ${today} | Kasir A=${A.full_name} B=${B.full_name} | Produk: ${prods.map((p) => p.name).join(', ')}`);

  // ── Opsional: langkah ADMIN via HTTP asli ──
  const admNidn = process.env.E2E_ADMIN_NIDN, admPw = process.env.E2E_ADMIN_PASSWORD;
  let adminCk = '';
  if (admNidn && admPw) {
    const l = await http('POST', '/api/auth/admin', '', { nidn: admNidn, password: admPw });
    adminCk = cookieFrom(l.headers, 'sk_admin');
    check('Admin · login', l.status === 200 && !!adminCk, `HTTP ${l.status}`);
    const qtyAfter = prods[0].stock_qty + 10;
    const adj = await http('POST', '/api/admin/stok-adjustment', adminCk, { productId: prods[0].id, qtyAfter, reason: 'E2E uji stok masuk pagi' });
    const [p0] = await sql`SELECT stock_qty FROM products WHERE id=${prods[0].id}`;
    check('Admin · edit stok (+10) tersimpan', adj.status < 300 && p0?.stock_qty === qtyAfter, `HTTP ${adj.status}, stok ${prods[0].stock_qty}→${p0?.stock_qty}`);
    prods[0].stock_qty = qtyAfter;
  } else {
    skip('Admin · edit stok & laporan via HTTP', 'butuh E2E_ADMIN_NIDN/E2E_ADMIN_PASSWORD (kredensial staging)');
  }

  // ── SHIFT 1 (kasir A) lalu GANTI SHIFT (kasir B) ──
  const s1 = await kasirDay({
    label: 'SHIFT-1', emp: A, prods, shortage: 0,
    txPlan: [
      { items: [{ p: 0, qty: 1 }], pay: 'CASH' },
      { items: [{ p: 1, qty: 2 }], pay: 'QRIS' },
      { items: [{ p: 0, qty: 1 }, { p: 1, qty: 1 }], pay: 'SPLIT' },
    ],
  });
  const s2 = await kasirDay({
    label: 'SHIFT-2', emp: B, prods, shortage: 5000,
    txPlan: [
      { items: [{ p: 0, qty: 2 }], pay: 'CASH' },
      { items: [{ p: 1, qty: 1 }], pay: 'QRIS' },
    ],
  });
  check('Ganti shift · dua shift berbeda, keduanya CLOSED', s1.shiftId !== s2.shiftId &&
    (await sql`SELECT count(*)::int c FROM shifts WHERE id = ANY(${[s1.shiftId, s2.shiftId]}) AND status='CLOSED'`)[0].c === 2);

  // ── MANAGER: verifikasi laporan, selisih, stok (ORACLE SQL independen) ──
  console.log('\n══════ MANAGER: laporan, selisih, stok ══════');
  const shiftsDb = await sql`SELECT id, modal_awal, actual_cash FROM shifts WHERE id = ANY(${[s1.shiftId, s2.shiftId]})`;
  for (const [lbl, s] of [['SHIFT-1', s1], ['SHIFT-2', s2]] as const) {
    const sh = shiftsDb.find((x) => x.id === s.shiftId)!;
    const [cs] = await sql`
      SELECT COALESCE(SUM(tp.amount),0) AS cash FROM transaction_payments tp
      JOIN transactions t ON t.id=tp.transaction_id
      WHERE t.shift_id=${s.shiftId} AND t.status='COMPLETED' AND t.is_test=false AND tp.payment_method='CASH'`;
    const expected = num(sh.modal_awal) + num(cs.cash);
    const selisih = num(sh.actual_cash) - expected;
    const want = lbl === 'SHIFT-1' ? 0 : -5000;
    check(`Selisih laci ${lbl} = ${rupiah(want)}`, Math.abs(selisih - want) < 0.01, `diharapkan ${rupiah(expected)}, fisik ${rupiah(num(sh.actual_cash))}, selisih ${rupiah(selisih)}`);
  }
  const rep = await getFinancialReport(resolveReportRange({ period: 'daily' }));
  const expectOmzet = s1.omzet + s2.omzet;
  check('Laporan harian · omzet = jumlah penjualan kedua shift', Math.abs(rep.summary.omzet - expectOmzet) < 0.01,
    `laporan ${rupiah(rep.summary.omzet)} vs oracle ${rupiah(expectOmzet)}`);
  check('Laporan harian · jumlah transaksi', rep.summary.txCount === s1.committed + s2.committed, `${rep.summary.txCount}`);
  check('Laporan harian · omzet tunai + QRIS = omzet total', Math.abs(rep.summary.omzetCash + rep.summary.omzetQris - rep.summary.omzet) < 0.01);

  // Stok: harus berkurang PERSIS sebanyak terjual (+ koreksi admin bila ada)
  for (const [i, p] of prods.entries()) {
    const [now] = await sql`SELECT stock_qty FROM products WHERE id=${p.id}`;
    const sold = s1.soldQty[i]! + s2.soldQty[i]!;
    check(`Stok ${p.name} berkurang tepat ${sold}`, now.stock_qty === p.stock_qty - sold, `${p.stock_qty}→${now.stock_qty}`);
  }
  const [neg] = await sql`SELECT (SELECT count(*) FROM products WHERE stock_qty<0)::int p, (SELECT count(*) FROM stock_batches WHERE current_qty<0)::int b`;
  check('Tidak ada stok negatif', neg.p === 0 && neg.b === 0);

  // ── Opsional: laporan manager lewat HTTP asli ──
  if (adminCk) {
    const rk = await http('GET', `/api/admin/laporan/rekap-kasir?dateFrom=${today}&dateTo=${today}`, adminCk);
    const det = firstArray<ShiftDetail>(rk.json, 'data.shiftDetails');
    const d1 = det.find((d) => d.shiftId === s1.shiftId), d2 = det.find((d) => d.shiftId === s2.shiftId);
    check('Manager HTTP · rekap-kasir selisih SHIFT-1=0 & SHIFT-2=-5000',
      !!d1 && !!d2 && Math.abs(num(d1.discrepancy)) < 0.01 && Math.abs(num(d2.discrepancy) + 5000) < 0.01,
      `HTTP ${rk.status}; d1=${d1?.discrepancy} d2=${d2?.discrepancy}`);
    const jt = await http('GET', `/api/admin/laporan/jejak-transaksi?dateFrom=${today}&dateTo=${today}&limit=200`, adminCk);
    const rows = firstArray<LogApiRow>(jt.json, 'data.rows');
    const mine = rows.filter((r) => [A.id, B.id].includes(r.employeeId));
    check('Manager HTTP · Jejak Transaksi menampilkan COMMITTED & REJECTED',
      mine.filter((r) => r.outcome === 'COMMITTED').length === s1.committed + s2.committed && mine.some((r) => r.outcome === 'REJECTED'),
      `HTTP ${jt.status}, baris=${mine.length}`);
  }
}

async function cleanup() {
  console.log('\n══════ CLEANUP ══════');
  try {
    const txIds = created.txIds;
    await sql`DELETE FROM transaction_logs WHERE (employee_id = ANY(${snapJabatan.map((e) => e.id)}) AND created_at >= ${startedAt}) OR transaction_id = ANY(${txIds})`;
    await sql`DELETE FROM transaction_payments WHERE transaction_id = ANY(${txIds})`;
    await sql`DELETE FROM transaction_items WHERE transaction_id = ANY(${txIds})`;
    await sql`DELETE FROM transactions WHERE id = ANY(${txIds})`;
    await sql`DELETE FROM attendances WHERE id = ANY(${created.attIds})`;
    await sql`DELETE FROM shifts WHERE id = ANY(${created.shiftIds.filter(Boolean)})`;
    for (const p of snapProducts) await sql`UPDATE products SET stock_qty=${p.stock_qty} WHERE id=${p.id}`;
    for (const b of snapBatches) await sql`UPDATE stock_batches SET current_qty=${b.current_qty} WHERE id=${b.id}`;
    for (const e of snapJabatan) await sql`UPDATE employees SET jabatan=${e.jabatan} WHERE id=${e.id}`;
    try { await sql`DELETE FROM stock_adjustments WHERE product_id = ANY(${snapProducts.map((p) => p.id)}) AND created_at >= ${startedAt}`; }
    catch (e) { console.log('(stock_adjustments tidak dibersihkan:', (e as Error).message, ')'); }
    const [left] = await sql`SELECT count(*)::int c FROM transactions WHERE id = ANY(${txIds})`;
    console.log(`Data uji dihapus; sisa transaksi uji: ${left.c}; stok & batch dipulihkan.`);
  } catch (e) {
    console.error('❌ CLEANUP GAGAL — periksa manual:', e);
  }
}

main()
  .catch((e) => { check('FATAL', false, (e as Error).message); })
  .finally(async () => {
    await cleanup();
    const fail = results.filter((r) => r.ok === false).length;
    const pass = results.filter((r) => r.ok === true).length;
    const sk = results.filter((r) => r.ok === 'SKIP').length;
    console.log(`\nHASIL: ${pass} lulus, ${fail} gagal, ${sk} dilewati`);
    await sql.end();
    process.exit(fail ? 1 : 0);
  });
