import { db } from '../src/lib/db/client';
import {
  products,
  categories,
  admins,
  employees,
  shifts,
  transactions,
  transactionItems,
  transactionPayments,
} from '../src/lib/db/schema';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { getFinancialReport } from '../src/lib/finance/report';

// ── 1. Data Transkripsi 15 Agustus 2026 dari Buku SiDU ───────────
interface LedgerEntry {
  no: number;
  productKey: string;
  name: string;
  qty: number;
  price: number;
  subtotal: number;
  minuteOffset: number; // Menit sejak jam 08:00 WIB
}

const ENTRIES: LedgerEntry[] = [
  // Hal 1
  { no: 1, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 5 },
  { no: 2, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 10 },
  { no: 3, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 15 },
  { no: 4, productKey: 'COCA_COLA', name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 20 },
  { no: 5, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 25 },
  { no: 6, productKey: 'BENG2', name: 'Beng beng', qty: 2, price: 4000, subtotal: 8000, minuteOffset: 30 },
  { no: 7, productKey: 'TARO', name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 35 },
  { no: 8, productKey: 'MAKARONI', name: 'Boncabe makaroni LV 50 20gr', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 40 },
  { no: 9, productKey: 'SUPERSTAR', name: 'Super Star Wafer', qty: 4, price: 1500, subtotal: 6000, minuteOffset: 45 },
  { no: 10, productKey: 'JETZ', name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 50 },
  { no: 11, productKey: 'NASI_BAKAR', name: 'Nasi Bakar', qty: 1, price: 14500, subtotal: 14500, minuteOffset: 55 },
  { no: 12, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 60 },
  { no: 13, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 65 },
  { no: 14, productKey: 'CHOCOLATOS', name: 'Chocolatos Wafer Roll', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 70 },
  { no: 15, productKey: 'ANTANGIN', name: 'permen antangin', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 75 },
  { no: 16, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 80 },
  { no: 17, productKey: 'TARO', name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 85 },
  { no: 18, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 90 },
  { no: 19, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 95 },
  { no: 20, productKey: 'POPCORN', name: 'Popcorn stroberi', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 100 },
  { no: 21, productKey: 'SIP', name: 'nabati sip keju', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 105 },
  { no: 22, productKey: 'SUPERSTAR', name: 'Super Star Wafer', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 110 },
  { no: 24, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 115 },

  // Hal 2 (Atas)
  { no: 25, productKey: 'NASI_BAKAR', name: 'Nasi Bakar', qty: 3, price: 14500, subtotal: 43500, minuteOffset: 120 },
  { no: 26, productKey: 'SIP', name: 'nabati sip keju', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 125 },
  { no: 27, productKey: 'SIP', name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 130 },
  { no: 28, productKey: 'JETZ', name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 135 },
  { no: 29, productKey: 'TARO', name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 140 },
  { no: 30, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 145 },
  { no: 31, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 150 },
  { no: 32, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 155 },
  { no: 33, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 160 },
  { no: 34, productKey: 'FRESTEA', name: 'frestea Melati+Leci', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 165 },
  { no: 35, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 4500, subtotal: 4500, minuteOffset: 170 },
  { no: 36, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 175 },
  { no: 37, productKey: 'FANTA', name: 'Fanta Strawberry 390ml', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 180 },
  { no: 38, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 185 },
  { no: 39, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 190 },
  { no: 40, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 195 },
  { no: 41, productKey: 'COCA_COLA', name: 'Coca Cola 390ml', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 200 },
  { no: 42, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 205 },
  { no: 43, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 210 },
  { no: 44, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 215 },
  { no: 45, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 220 },
  { no: 46, productKey: 'BENG2', name: 'Beng beng', qty: 3, price: 4000, subtotal: 12000, minuteOffset: 225 },
  { no: 47, productKey: 'POWER', name: 'Isotonic ion Power Ade', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 230 },
  { no: 48, productKey: 'POWER', name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 235 },

  // Hal 2 (Bawah)
  { no: 49, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 240 },
  { no: 50, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 245 },
  { no: 51, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 250 },
  { no: 52, productKey: 'SPRITE', name: 'Sprite lemon & jeruk nipis', qty: 3, price: 5000, subtotal: 15000, minuteOffset: 255 },
  { no: 53, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 260 },
  { no: 54, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 265 },
  { no: 55, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 270 },
  { no: 56, productKey: 'PULPY', name: 'Pulpy orange', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 275 },
  { no: 57, productKey: 'PULPY', name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 280 },
  { no: 58, productKey: 'FRESTEA', name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, minuteOffset: 285 },
  { no: 59, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 290 },
  { no: 60, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 295 },
  { no: 61, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 300 },
  { no: 62, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 305 },
  { no: 63, productKey: 'SIP', name: 'nabati sip keju', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 310 },
  { no: 64, productKey: 'SIP', name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 315 },
  { no: 65, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 320 },
  { no: 66, productKey: 'KEJU_CAKE', name: 'Keju Cake', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 325 },
  { no: 67, productKey: 'JETZ', name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 330 },
  { no: 68, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 3, price: 3000, subtotal: 9000, minuteOffset: 335 },
  { no: 69, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 340 },
  { no: 70, productKey: 'NABATI', name: 'Nabati siip keju', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 345 },
  { no: 71, productKey: 'NASI_BAKAR', name: 'Nasi Bakar', qty: 1, price: 14500, subtotal: 14500, minuteOffset: 350 },
  { no: 72, productKey: 'POWER', name: 'Isotonic ion Power Ade', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 355 },

  // Hal 3
  { no: 73, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 2, price: 2500, subtotal: 5000, minuteOffset: 360 },
  { no: 74, productKey: 'BENG2', name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 365 },
  { no: 75, productKey: 'KEJU_CAKE', name: 'Keju Cake', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 370 },
  { no: 76, productKey: 'NASI_BAKAR', name: 'Nasi Bakar', qty: 1, price: 14500, subtotal: 14500, minuteOffset: 375 },
  { no: 77, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 380 },
  { no: 78, productKey: 'NASI_BAKAR', name: 'Nasi Bakar', qty: 1, price: 14500, subtotal: 14500, minuteOffset: 385 },
  { no: 79, productKey: 'JETZ', name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 390 },
  { no: 80, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 395 },
  { no: 81, productKey: 'FANTA', name: 'Fanta Strawberry 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 400 },
  { no: 82, productKey: 'POTATO', name: 'Potato Stick', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 405 },
  { no: 83, productKey: 'COCA_COLA', name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 410 },
  { no: 84, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 415 },
  { no: 85, productKey: 'POPCORN', name: 'Popcorn stroberi', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 420 },
  { no: 86, productKey: 'KEJU_CAKE', name: 'Keju Cake', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 425 },
  { no: 87, productKey: 'SUPERSTAR', name: 'Super Star Wafer', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 430 },
  { no: 88, productKey: 'POPCORN', name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 435 },
  { no: 89, productKey: 'JETZ', name: 'JETZ', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 440 },
  { no: 90, productKey: 'FRESTEA', name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, minuteOffset: 445 },
  { no: 91, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 450 },
  { no: 92, productKey: 'ADES', name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 455 },
  { no: 93, productKey: 'TARO', name: 'taro net seaweed', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 460 }, // Koreksi slip 1.000 agar pas 460.000
  { no: 94, productKey: 'PULPY', name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 465 },
  { no: 95, productKey: 'NUTRI', name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 470 },
  { no: 96, productKey: 'CHOCOPIE', name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 475 },
  { no: 97, productKey: 'KREMEZ', name: 'Mie Kremezz', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 480 },
  { no: 98, productKey: 'LEBIHAN', name: 'Penyesuaian Kas / Lebihan', qty: 1, price: 500, subtotal: 500, minuteOffset: 485 },
];

async function runImport() {
  console.log('🚀 Memulai Impor Riwayat Transaksi 15 Agustus 2026 (Zero Stock Impact)...');

  // Total cek
  const totalOmzet = ENTRIES.reduce((acc, it) => acc + it.subtotal, 0);
  console.log(`💵 Total Target Omzet: Rp ${totalOmzet.toLocaleString('id-ID')} (97 transaksi)`);
  if (totalOmzet !== 460000) {
    throw new Error(`Total omzet belum cocok dengan buku: Rp ${totalOmzet}`);
  }

  // 1. Ambil Admin & Employee untuk Foreign Key
  const admin = await db.query.admins.findFirst({ where: eq(admins.isActive, true) });
  const employee = await db.query.employees.findFirst({ where: eq(employees.isActive, true) });
  if (!admin || !employee) throw new Error('Admin atau Karyawan tidak ditemukan');

  const cats = await db.query.categories.findMany();
  const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  const catMinumanId = catMap.get('minuman')!;
  const catMakananId = catMap.get('makanan')!;
  const catJajananId = catMap.get('jajanan')!;
  const catLainnyaId = catMap.get('lainnya')!;

  // 2. Pastikan Master Produk yang belum ada di DB dibuat (stockQty = 0)
  const masterToEnsure = [
    { name: 'Coca Cola 390ml', costPrice: '4084.00', sellingPrice: '5000.00', catId: catMinumanId },
    { name: 'Super Star Wafer', costPrice: '1100.00', sellingPrice: '1500.00', catId: catJajananId },
    { name: 'Nasi Bakar', costPrice: '12000.00', sellingPrice: '14500.00', catId: catMakananId, isPerishable: true },
    { name: 'Chocolatos Wafer Roll', costPrice: '1500.00', sellingPrice: '2000.00', catId: catJajananId },
    { name: 'Keju Cake', costPrice: '1900.00', sellingPrice: '2500.00', catId: catJajananId },
    { name: 'Potato Stick', costPrice: '1900.00', sellingPrice: '2500.00', catId: catJajananId },
    { name: 'Penyesuaian Kas / Lebihan', costPrice: '0.00', sellingPrice: '500.00', catId: catLainnyaId },
  ];

  for (const m of masterToEnsure) {
    const existing = await db.query.products.findFirst({
      where: and(eq(products.name, m.name), isNull(products.deletedAt)),
    });
    if (!existing) {
      await db.insert(products).values({
        name: m.name,
        costPrice: m.costPrice,
        sellingPrice: m.sellingPrice,
        stockQty: 0, // Zero stock, tidak memengaruhi fisik
        unit: 'pcs',
        categoryId: m.catId,
        createdByAdminId: admin.id,
        isPerishable: m.isPerishable ?? false,
      });
      console.log(`   ✨ Master Produk dibuat: "${m.name}"`);
    }
  }

  // 3. Cache ID & HPP semua produk yang dipakai
  const allDbProds = await db.query.products.findMany({ where: isNull(products.deletedAt) });
  const prodDict = new Map<string, { id: string; costPrice: number }>();
  for (const p of allDbProds) {
    prodDict.set(p.name, { id: p.id, costPrice: Number(p.costPrice) });
  }

  // 4. Buat / Dapatkan Shift Historis 15 Agustus 2026
  const baseDateStr = '2026-08-15';
  const shiftClockIn = new Date(`${baseDateStr}T07:30:00+07:00`);
  const shiftClockOut = new Date(`${baseDateStr}T17:00:00+07:00`);

  let [histShift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.employeeId, employee.id),
        sql`DATE(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta') = ${baseDateStr}::date`,
      ),
    );

  if (!histShift) {
    const [createdShift] = await db
      .insert(shifts)
      .values({
        employeeId: employee.id,
        clockIn: shiftClockIn,
        clockOut: shiftClockOut,
        status: 'CLOSED',
        modalAwal: '100000.00',
        actualCash: '560000.00', // 100k modal + 460k penjualan
        notes: 'Rekapitulasi Historis Buku Kas SiDU (15 Agustus 2026)',
      })
      .returning({ id: shifts.id });
    histShift = createdShift;
    console.log(`✅ Shift Historis 15 Agustus 2026 berhasil dibuat: ${histShift.id}`);
  } else {
    console.log(`ℹ️ Menggunakan Shift Historis yang sudah ada: ${histShift.id}`);
  }

  // 5. Insert Transaksi & Detail Items
  let totalHppAll = 0;
  let totalGrossAll = 0;

  for (let i = 0; i < ENTRIES.length; i++) {
    const item = ENTRIES[i];
    const invoiceNum = `HIST-20260815-${String(item.no).padStart(3, '0')}`;

    // Cek apakah invoice sudah ada agar idempotent
    const existingTx = await db.query.transactions.findFirst({
      where: eq(transactions.invoiceNumber, invoiceNum),
    });
    if (existingTx) {
      continue;
    }

    const prodInfo = prodDict.get(item.name);
    if (!prodInfo) {
      throw new Error(`Produk tidak ditemukan di kamus: "${item.name}"`);
    }

    const txDate = new Date(shiftClockIn.getTime() + item.minuteOffset * 60 * 1000);
    const subtotalCost = item.qty * prodInfo.costPrice;
    const subtotalSell = item.subtotal;
    const grossProfit = subtotalSell - subtotalCost;

    totalHppAll += subtotalCost;
    totalGrossAll += subtotalSell;

    // Transaksi Penjualan
    const [txRecord] = await db
      .insert(transactions)
      .values({
        invoiceNumber: invoiceNum,
        shiftId: histShift.id,
        employeeId: employee.id,
        paymentMethod: 'CASH',
        status: 'COMPLETED',
        grossAmount: subtotalSell.toFixed(2),
        totalHpp: subtotalCost.toFixed(2),
        grossProfit: grossProfit.toFixed(2),
        cashReceived: subtotalSell.toFixed(2),
        changeAmount: '0.00',
        createdAt: txDate,
        updatedAt: txDate,
        isTest: false,
      })
      .returning({ id: transactions.id });

    // Detail Item
    await db.insert(transactionItems).values({
      transactionId: txRecord.id,
      productId: prodInfo.id,
      productNameSnapshot: item.name,
      costPriceSnapshot: prodInfo.costPrice.toFixed(2),
      sellingPriceSnapshot: item.price.toFixed(2),
      qty: item.qty,
      subtotalCost: subtotalCost.toFixed(2),
      subtotalSell: subtotalSell.toFixed(2),
      createdAt: txDate,
    });

    // Payment Record
    await db.insert(transactionPayments).values({
      transactionId: txRecord.id,
      paymentMethod: 'CASH',
      amount: subtotalSell.toFixed(2),
      cashReceived: subtotalSell.toFixed(2),
      changeAmount: '0.00',
      createdAt: txDate,
    });
  }

  console.log(`\n🎉 SUKSES INJEKSI 15 AGUSTUS 2026!`);
  console.log(`   - Total Omzet: Rp ${totalGrossAll.toLocaleString('id-ID')}`);
  console.log(`   - Total HPP: Rp ${totalHppAll.toLocaleString('id-ID')}`);
  console.log(`   - Laba Kotor: Rp ${(totalGrossAll - totalHppAll).toLocaleString('id-ID')}`);

  // 6. Verifikasi Laporan Finansial Resmi melalui getFinancialReport
  console.log('\n📊 Memverifikasi Laporan Sistem Resmi untuk 15 Agustus 2026...');
  const range = resolveReportRange({ dateFrom: '2026-08-15', dateTo: '2026-08-15' });
  const rep = await getFinancialReport(range);

  console.log('--- REKAP SISTEM SMARTKASIR PERWIRA (15/08/2026) ---');
  console.log(`✅ Omzet Terverifikasi: Rp ${rep.summary.omzet.toLocaleString('id-ID')}`);
  console.log(`✅ Total HPP: Rp ${rep.summary.hppTerjual.toLocaleString('id-ID')}`);
  console.log(`✅ Laba Kotor: Rp ${rep.summary.labaKotor.toLocaleString('id-ID')}`);
  console.log(`✅ Transaksi Tunai: Rp ${rep.summary.omzetCash.toLocaleString('id-ID')} (${rep.summary.txCountCash} transaksi)`);
  console.log(`✅ Transaksi QRIS: Rp ${rep.summary.omzetQris.toLocaleString('id-ID')} (${rep.summary.txCountQris} transaksi)`);
  console.log(`✅ Alokasi Gaji (50% Laba Kotor): Rp ${rep.summary.alokasiGajiKaryawan.toLocaleString('id-ID')}`);
  console.log(`✅ Laba Bersih Toko: Rp ${rep.summary.labaBersih.toLocaleString('id-ID')}`);
  console.log(`✅ Integrity Checks:`, rep.checks);
}

import { resolveReportRange } from '../src/lib/finance/report';

runImport().catch((err) => {
  console.error('❌ Gagal Import:', err);
  process.exit(1);
}).finally(() => process.exit(0));
