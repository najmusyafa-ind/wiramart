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
  shiftCashMovements,
} from '../src/lib/db/schema';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { getFinancialReport, resolveReportRange } from '../src/lib/finance/report';

interface Entry {
  name: string;
  qty: number;
  price: number;
  subtotal: number;
  minuteOffset: number;
  costPrice?: number;
}

interface DayBatch {
  date: string; // YYYY-MM-DD
  modalAwal: number;
  notes: string;
  cashierName: string;
  employeeFilter: string; // name search in employees
  entries: Entry[];
  cashMovements?: Array<{
    type: 'CASH_OUT' | 'CASH_IN';
    amount: number;
    category: string;
    notes: string;
  }>;
  actualCashExpected: number;
}

// ── 1. DEFINISI DATA PER HARI (27 Ags s/d 14 Sep 2026) ─────────────

const DAYS: DayBatch[] = [
  // ── 27 Agustus 2026 ──
  {
    date: '2026-08-27',
    modalAwal: 100000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (27 Agustus 2026)',
    actualCashExpected: 113500,
    entries: [
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 30 },
      { name: 'Makaroni Krispi', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 60 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 90 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 120 },
      { name: 'VIP Chips', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 150 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 180 },
    ],
  },

  // ── 31 Agustus 2026 ──
  {
    date: '2026-08-31',
    modalAwal: 113500,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (31 Agustus 2026 - Modal paraf Sucipto)',
    actualCashExpected: 139500,
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 30 },
      { name: 'Yupi', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 60 },
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 90 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 120 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 150 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 180 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 210 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 4500, subtotal: 4500, minuteOffset: 240 },
    ],
  },

  // ── 01 September 2026 ──
  {
    date: '2026-09-01',
    modalAwal: 139500,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (01 September 2026)',
    actualCashExpected: 176500,
    entries: [
      { name: 'Potato Stick', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 30 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 50 },
      { name: 'Potato Stick', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 70 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 90 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 110 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 130 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 150 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 170 },
      { name: 'Keju Cake', qty: 2, price: 2500, subtotal: 5000, minuteOffset: 190 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 210 },
      { name: 'Super Star Wafer', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 230 },
      { name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 250 },
    ],
  },

  // ── 02 September 2026 ──
  {
    date: '2026-09-02',
    modalAwal: 176500,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (02 September 2026)',
    actualCashExpected: 204000,
    entries: [
      { name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 30 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 60 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 90 },
      { name: 'Goat Milk', qty: 1, price: 8500, subtotal: 8500, minuteOffset: 120 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 3, price: 3000, subtotal: 9000, minuteOffset: 150 },
      { name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 180 },
    ],
  },

  // ── 03 September 2026 ──
  {
    date: '2026-09-03',
    modalAwal: 204000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (03 September 2026 - Setor Kas Rp 150.000 paraf Dean Sp)',
    actualCashExpected: 113000, // 204.000 + 57.500 + 1.500 lebihan - 150.000 setor = 113.000
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 150000,
        category: 'OPERASIONAL',
        notes: 'Setoran Kas Tunai (Paraf Dean Sp)',
      },
    ],
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 30 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 45 },
      { name: 'Nabati Sip Coklat', qty: 2, price: 1000, subtotal: 2000, minuteOffset: 60 },
      { name: 'VIP Chips', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 75 },
      { name: 'Makaroni Krispi', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 90 },
      { name: 'Kuaci Rebo Rasa Green Tea', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 105 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 120 },
      { name: 'Pilus Garuda', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 135 },
      { name: 'VIP Chips', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 150 },
      { name: 'Nabati Sip Coklat', qty: 2, price: 1000, subtotal: 2000, minuteOffset: 165 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 180 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 195 },
      // Sesi Sore
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 240 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 255 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 270 },
      { name: 'Potato Stick', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 285 },
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 300 },
      { name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 315 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 330 },
      { name: 'Penyesuaian Kas / Lebihan', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 345 },
    ],
  },

  // ── 04 September 2026 ──
  {
    date: '2026-09-04',
    modalAwal: 113000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (04 September 2026)',
    actualCashExpected: 201000, // 113.000 + 88.000 = 201.000
    entries: [
      { name: 'Makaroni Krispi', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 30 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 45 },
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 60 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 75 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 90 },
      { name: 'Potato Stick', qty: 2, price: 4000, subtotal: 8000, minuteOffset: 105 },
      { name: 'Potato Stick', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 120 },
      { name: 'Potato Stick', qty: 3, price: 2000, subtotal: 6000, minuteOffset: 135 },
      { name: 'Oishi caramel popcorn', qty: 3, price: 2000, subtotal: 6000, minuteOffset: 150 },
      { name: 'Makaroni Krispi', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 165 },
      { name: 'Potato Stick', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 180 },
      { name: 'Permen Relaxa', qty: 8, price: 500, subtotal: 4000, minuteOffset: 195 },
      { name: 'Kuaci Rebo Rasa Green Tea', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 210 },
      { name: 'Pilus Garuda', qty: 3, price: 1000, subtotal: 3000, minuteOffset: 225 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 240 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 255 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 270 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 285 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 3, price: 3000, subtotal: 9000, minuteOffset: 300 },
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 315 },
      { name: 'Pilus Garuda', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 330 },
    ],
  },

  // ── 05 September 2026 ──
  {
    date: '2026-09-05',
    modalAwal: 201000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (05 September 2026)',
    actualCashExpected: 206000,
    entries: [
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 60 },
      { name: 'Pilus Garuda', qty: 6, price: 500, subtotal: 3000, minuteOffset: 120 },
    ],
  },

  // ── 06 September 2026 ──
  {
    date: '2026-09-06',
    modalAwal: 206000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (06 September 2026)',
    actualCashExpected: 213000,
    entries: [
      { name: 'Makaroni Krispi', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 60 },
      { name: 'Pilus Garuda', qty: 4, price: 500, subtotal: 2000, minuteOffset: 120 },
    ],
  },

  // ── 07 September 2026 ──
  {
    date: '2026-09-07',
    modalAwal: 213000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (07 September 2026)',
    actualCashExpected: 362000, // Termasuk penyesuaian kas tak tercatat di buku
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 30 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 45 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 60 },
      { name: 'Permen Relaxa', qty: 2, price: 500, subtotal: 1000, minuteOffset: 75 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 90 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 105 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 120 },
      { name: 'Mie Kremezz', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 135 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 150 },
      { name: 'Nutriboost Jeruk', qty: 2, price: 7000, subtotal: 14000, minuteOffset: 165 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 180 },
      { name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 195 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 210 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 225 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 240 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 255 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 270 },
      { name: 'Keju Cake', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 285 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 300 },
      { name: 'Bon Cabe', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 315 },
      { name: 'Penyesuaian Kas / Lebihan', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 330 },
    ],
  },

  // ── 08 September 2026 ──
  {
    date: '2026-09-08',
    modalAwal: 362000,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (08 September 2026)',
    actualCashExpected: 396500,
    entries: [
      { name: 'Mie Kremezz', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 30 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 60 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 90 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 120 },
      { name: 'Duosus', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 150 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 180 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 210 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 240 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 270 },
      { name: 'Fanta Strawberry 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 300 },
    ],
  },

  // ── 09 September 2026 ──
  {
    date: '2026-09-09',
    modalAwal: 396500,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'siska',
    notes: 'Rekapitulasi Buku Kas SiDU (09 September 2026 - Setor Kas Rp 385.000)',
    actualCashExpected: 89500, // 396.500 + 78.000 - 385.000 = 89.500
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 385000,
        category: 'OPERASIONAL',
        notes: 'Setoran Kas Tunai',
      },
    ],
    entries: [
      { name: 'Nabati Sip Coklat', qty: 2, price: 1000, subtotal: 2000, minuteOffset: 30 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 50 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 70 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 90 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 110 },
      { name: 'Roti Oke', qty: 1, price: 10500, subtotal: 10500, minuteOffset: 130 },
      { name: 'Roti Oke', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 150 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 170 },
      { name: 'Mie Kremezz', qty: 2, price: 2500, subtotal: 5000, minuteOffset: 190 },
      { name: 'Roti Oke', qty: 1, price: 7000, subtotal: 7000, minuteOffset: 210 },
      { name: 'JETZ', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 230 },
      { name: 'Super Star Wafer', qty: 2, price: 1500, subtotal: 3000, minuteOffset: 250 },
      { name: 'Roti Oke', qty: 1, price: 10500, subtotal: 10500, minuteOffset: 270 },
      { name: 'Penyesuaian Kas / Lebihan', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 290 },
    ],
  },

  // ── 10 September 2026 ──
  {
    date: '2026-09-10',
    modalAwal: 102500,
    cashierName: 'Kasir Perwira',
    employeeFilter: 'meizin',
    notes: 'Rekapitulasi Buku Kas SiDU (10 September 2026)',
    actualCashExpected: 196500, // 102.500 + 94.000 = 196.500
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 20 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3000, subtotal: 3000, minuteOffset: 35 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3000, subtotal: 6000, minuteOffset: 50 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 4, price: 3000, subtotal: 12000, minuteOffset: 65 },
      { name: 'Super Star Wafer', qty: 2, price: 1500, subtotal: 3000, minuteOffset: 80 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 95 },
      { name: 'Oishi caramel popcorn', qty: 2, price: 2000, subtotal: 4000, minuteOffset: 110 },
      { name: 'Permen Relaxa', qty: 4, price: 500, subtotal: 2000, minuteOffset: 125 },
      { name: 'Isotonic ion Power Ade', qty: 4, price: 6000, subtotal: 24000, minuteOffset: 140 },
      { name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 155 },
      { name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 170 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, minuteOffset: 185 },
      { name: 'Mie Kremezz', qty: 1, price: 1500, subtotal: 1500, minuteOffset: 200 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 215 },
      { name: 'Nabati Sip Coklat', qty: 2, price: 1000, subtotal: 2000, minuteOffset: 230 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 245 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 260 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 275 },
      { name: 'Yupi', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 290 },
    ],
  },

  // ── 14 September 2026: SHIFT 1 (Pagi/Siang) ──
  {
    date: '2026-09-14',
    modalAwal: 150000,
    cashierName: 'Siska Febriani & Meizin Shinta Resmi',
    employeeFilter: 'siska',
    notes: 'Shift 1 (Pagi): Absensi Piket Siska & Meizin (Target: Rp 389.500)',
    actualCashExpected: 389500,
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 300000,
        category: 'OPERASIONAL',
        notes: 'Belanja Kulakan Bu Dyah (14 Sep 2026)',
      },
    ],
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 10 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 15 },
      { name: 'Roti Oke', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 20 },
      { name: 'Ayam Geprek', qty: 3, price: 10000, subtotal: 30000, minuteOffset: 25 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 30 },
      { name: 'Milk Tea', qty: 1, price: 15000, subtotal: 15000, minuteOffset: 35 },
      { name: 'Ayam Lada Hitam', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 40 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 45 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 50 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 55 },
      { name: 'Ayam Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 60 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 65 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 70 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 75 },
      { name: 'Ayam Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 80 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 85 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 90 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 95 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 100 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 105 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 110 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 115 },
      { name: 'Ayam Bakar', qty: 2, price: 8000, subtotal: 16000, minuteOffset: 120 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 125 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 130 },
      { name: 'Ayam Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 135 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 140 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 145 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 150 },
      { name: 'Pop Mie Kuah', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 155 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 160 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 165 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 170 },
      { name: 'Marshmallow Rainbow', qty: 2, price: 1000, subtotal: 2000, minuteOffset: 175 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 180 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 185 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 190 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 195 },
      { name: 'Pilus Garuda', qty: 1, price: 500, subtotal: 500, minuteOffset: 200 },
      { name: 'Mie Enak', qty: 1, price: 1000, subtotal: 1000, minuteOffset: 205 },
      { name: 'Pop Mie Kuah', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 210 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 215 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 220 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 225 },
      { name: 'Pizza Slice', qty: 1, price: 13000, subtotal: 13000, minuteOffset: 230 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 235 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 240 },
    ],
  },

  // ── 14 September 2026: SHIFT 2 (Sore/Lanjutan) ──
  {
    date: '2026-09-14',
    modalAwal: 0,
    cashierName: 'Nazila Awalia Solikhah & Aulia Putra Ramadhan',
    employeeFilter: 'nazila',
    notes: 'Shift 2 (Sore/Lanjutan): Absensi Piket Nazila & Rama (Target: Rp 188.000)',
    actualCashExpected: 188000,
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 300000,
        category: 'OPERASIONAL',
        notes: 'Setoran Kas Tunai (Paraf Dean 15/9/26)',
      },
    ],
    entries: [
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 250 },
      { name: 'Permen Relaxa', qty: 3, price: 500, subtotal: 1500, minuteOffset: 255 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 260 }, // Termasuk Tip 1.500
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 265 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 270 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, minuteOffset: 275 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 280 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, minuteOffset: 285 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 290 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 295 },
      { name: 'Pizza Regular', qty: 1, price: 16000, subtotal: 16000, minuteOffset: 300 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 305 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 310 },
      { name: 'Pop Mie Kuah', qty: 1, price: 8000, subtotal: 8000, minuteOffset: 315 },
      { name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 320 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 325 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, minuteOffset: 330 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 335 },
      { name: 'Pizza Regular', qty: 1, price: 16000, subtotal: 16000, minuteOffset: 340 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 345 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 350 },
      { name: 'Potato Stick', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 355 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, minuteOffset: 360 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 365 },
      { name: 'Kopi Susu Aren', qty: 1, price: 5000, subtotal: 5000, minuteOffset: 370 },
      // Foto ke-6
      { name: 'Chitato', qty: 2, price: 2500, subtotal: 5000, minuteOffset: 375 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 380 },
      { name: 'frestea Melati+Leci', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 385 },
      { name: 'frestea Melati+Leci', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 390 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, minuteOffset: 395 },
      { name: 'Chitato', qty: 1, price: 2000, subtotal: 2000, minuteOffset: 400 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 405 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, minuteOffset: 410 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 415 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, minuteOffset: 420 },
    ],
  },
];

async function main() {
  console.log('🚀 Memulai Impor Riwayat Transaksi 27 Agustus s/d 14 September 2026...');

  // 1. Ambil Admin & Karyawan
  const admin = await db.query.admins.findFirst({ where: eq(admins.isActive, true) });
  if (!admin) throw new Error('Admin tidak ditemukan');

  const allEmployees = await db.query.employees.findMany({ where: eq(employees.isActive, true) });
  const empMap = new Map<string, typeof allEmployees[0]>();
  for (const e of allEmployees) {
    if (e.fullName.toLowerCase().includes('siska')) empMap.set('siska', e);
    if (e.fullName.toLowerCase().includes('meizin')) empMap.set('meizin', e);
    if (e.fullName.toLowerCase().includes('nazila')) empMap.set('nazila', e);
    if (e.fullName.toLowerCase().includes('rama') || e.fullName.toLowerCase().includes('aulia putra')) empMap.set('rama', e);
  }

  const defaultEmp = empMap.get('siska') || allEmployees[0];

  // 2. Kategori Map
  const cats = await db.query.categories.findMany();
  const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  const catMinumanId = catMap.get('minuman')!;
  const catMakananId = catMap.get('makanan')!;
  const catJajananId = catMap.get('jajanan')!;
  const catLainnyaId = catMap.get('lainnya')!;

  // 3. Pastikan Master Produk yang Dibutuhkan Ada (stockQty = 0)
  const masterToEnsure = [
    { name: 'Makaroni Krispi', costPrice: '1500.00', sellingPrice: '2000.00', catId: catJajananId },
    { name: 'VIP Chips', costPrice: '1500.00', sellingPrice: '2000.00', catId: catJajananId },
    { name: 'Goat Milk', costPrice: '7000.00', sellingPrice: '8500.00', catId: catMinumanId },
    { name: 'Pilus Garuda', costPrice: '350.00', sellingPrice: '500.00', catId: catJajananId },
    { name: 'Permen Relaxa', costPrice: '300.00', sellingPrice: '500.00', catId: catJajananId },
    { name: 'Duosus', costPrice: '1500.00', sellingPrice: '2000.00', catId: catJajananId },
    { name: 'Bon Cabe', costPrice: '2000.00', sellingPrice: '2500.00', catId: catJajananId },
    { name: 'Roti Oke', costPrice: '6000.00', sellingPrice: '7500.00', catId: catMakananId, isPerishable: true },
    { name: 'Ayam Geprek', costPrice: '8000.00', sellingPrice: '10000.00', catId: catMakananId, isPerishable: true },
    { name: 'Ayam Bakar', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Ayam Lada Hitam', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Pentol Pedas', costPrice: '5000.00', sellingPrice: '6000.00', catId: catMakananId, isPerishable: true },
    { name: 'Pizza Slice', costPrice: '10000.00', sellingPrice: '13000.00', catId: catMakananId, isPerishable: true },
    { name: 'Pizza Regular', costPrice: '12000.00', sellingPrice: '16000.00', catId: catMakananId, isPerishable: true },
    { name: 'Pop Mie Kuah', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId },
    { name: 'Milk Tea', costPrice: '12000.00', sellingPrice: '15000.00', catId: catMinumanId },
    { name: 'Kopi Susu Aren', costPrice: '3500.00', sellingPrice: '5000.00', catId: catMinumanId },
    { name: 'Marshmallow Rainbow', costPrice: '700.00', sellingPrice: '1000.00', catId: catJajananId },
    { name: 'Mie Enak', costPrice: '700.00', sellingPrice: '1000.00', catId: catJajananId },
    { name: 'Chitato', costPrice: '2000.00', sellingPrice: '2500.00', catId: catJajananId },
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
        stockQty: 0,
        unit: 'pcs',
        categoryId: m.catId,
        createdByAdminId: admin.id,
        isPerishable: m.isPerishable ?? false,
      });
      console.log(`   ✨ Master Produk dibuat: "${m.name}"`);
    }
  }

  // 4. Cache Semua Produk
  const allProds = await db.query.products.findMany({ where: isNull(products.deletedAt) });
  const prodDict = new Map<string, { id: string; costPrice: number }>();
  for (const p of allProds) {
    prodDict.set(p.name, { id: p.id, costPrice: Number(p.costPrice) });
  }

  const ALIASES: Record<string, string> = {
    'Yupi': 'Yupi Gummi Pizza',
  };

  let totalTransactionsCreated = 0;
  let totalGrandOmzet = 0;

  // 5. Eksekusi per Hari
  for (const day of DAYS) {
    const dayOmzet = day.entries.reduce((a, b) => a + b.subtotal, 0);
    totalGrandOmzet += dayOmzet;
    console.log(`\n📅 Memproses Tanggal ${day.date}: ${day.cashierName} (Target: Rp ${dayOmzet.toLocaleString('id-ID')})`);

    const chosenEmp = empMap.get(day.employeeFilter) || defaultEmp;

    // Tentukan waktu shift
    const isShift2 = day.notes.includes('Shift 2');
    const clockInHour = isShift2 ? '13:00:00' : '07:30:00';
    const clockOutHour = isShift2 ? '18:00:00' : (day.date === '2026-09-14' ? '13:00:00' : '17:00:00');

    const shiftClockIn = new Date(`${day.date}T${clockInHour}+07:00`);
    const shiftClockOut = new Date(`${day.date}T${clockOutHour}+07:00`);

    // Cek apakah shift untuk hari & employee ini sudah ada
    let [existingShift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.employeeId, chosenEmp.id),
          sql`DATE(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta') = ${day.date}::date`,
          isShift2 ? sql`${shifts.notes} LIKE '%Shift 2%'` : sql`(${shifts.notes} NOT LIKE '%Shift 2%' OR ${shifts.notes} IS NULL)`
        )
      );

    let currentShiftId = existingShift?.id;

    if (!currentShiftId) {
      const [newShift] = await db
        .insert(shifts)
        .values({
          employeeId: chosenEmp.id,
          clockIn: shiftClockIn,
          clockOut: shiftClockOut,
          status: 'CLOSED',
          modalAwal: day.modalAwal.toFixed(2),
          actualCash: day.actualCashExpected.toFixed(2),
          notes: day.notes,
        })
        .returning({ id: shifts.id });
      currentShiftId = newShift.id;
      console.log(`   ✅ Shift dibuat: ID ${currentShiftId}`);
    } else {
      console.log(`   ℹ️ Shift sudah ada: ID ${currentShiftId}`);
    }

    // Catat Cash Movement (jika ada)
    if (day.cashMovements && day.cashMovements.length > 0) {
      for (const cm of day.cashMovements) {
        // Cek duplikat movement
        const existingCm = await db.query.shiftCashMovements.findFirst({
          where: and(
            eq(shiftCashMovements.shiftId, currentShiftId),
            eq(shiftCashMovements.notes, cm.notes)
          ),
        });
        if (!existingCm) {
          await db.insert(shiftCashMovements).values({
            shiftId: currentShiftId,
            employeeId: chosenEmp.id,
            movementType: cm.type,
            category: cm.category,
            amount: cm.amount.toFixed(2),
            notes: cm.notes,
            createdAt: shiftClockIn,
          });
          console.log(`   💸 Kas Gerak dicatat: ${cm.type} Rp ${cm.amount.toLocaleString('id-ID')} (${cm.notes})`);
        }
      }
    }

    // Insert Transaksi
    let txIndex = 1;
    for (const entry of day.entries) {
      const resolvedName = ALIASES[entry.name] || entry.name;
      let prodInfo = prodDict.get(resolvedName);
      if (!prodInfo) {
        // Coba case-insensitive lookup
        for (const [pName, pVal] of prodDict.entries()) {
          if (pName.toLowerCase() === resolvedName.toLowerCase()) {
            prodInfo = pVal;
            break;
          }
        }
      }
      if (!prodInfo) {
        // Auto create missing product
        const [newP] = await db
          .insert(products)
          .values({
            name: resolvedName,
            costPrice: ((entry.price * 0.75)).toFixed(2),
            sellingPrice: entry.price.toFixed(2),
            stockQty: 0,
            unit: 'pcs',
            categoryId: catJajananId,
            createdByAdminId: admin.id,
          })
          .returning({ id: products.id, costPrice: products.costPrice });
        prodInfo = { id: newP.id, costPrice: Number(newP.costPrice) };
        prodDict.set(resolvedName, prodInfo);
        console.log(`   ✨ Auto-Created Master Produk: "${resolvedName}"`);
      }

      const txDate = new Date(`${day.date}T${isShift2 ? '13' : '08'}:00:00+07:00`);
      txDate.setMinutes(txDate.getMinutes() + entry.minuteOffset);

      // Cek apakah invoice nomor ini sudah ada
      const invSuffix = `${day.date.replace(/-/g, '')}-${isShift2 ? 'S2' : 'S1'}-${String(txIndex).padStart(3, '0')}`;
      const invNumber = `INV-${invSuffix}`;

      const existingTx = await db.query.transactions.findFirst({
        where: eq(transactions.invoiceNumber, invNumber),
      });

      if (!existingTx) {
        const itemCost = entry.costPrice ?? prodInfo.costPrice;
        const subtotalCost = itemCost * entry.qty;
        const subtotalSell = entry.subtotal;
        const grossProfit = subtotalSell - subtotalCost;

        const [createdTx] = await db
          .insert(transactions)
          .values({
            invoiceNumber: invNumber,
            shiftId: currentShiftId,
            employeeId: chosenEmp.id,
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

        await db.insert(transactionItems).values({
          transactionId: createdTx.id,
          productId: prodInfo.id,
          productNameSnapshot: entry.name,
          costPriceSnapshot: itemCost.toFixed(2),
          sellingPriceSnapshot: entry.price.toFixed(2),
          qty: entry.qty,
          subtotalCost: subtotalCost.toFixed(2),
          subtotalSell: subtotalSell.toFixed(2),
          createdAt: txDate,
        });

        await db.insert(transactionPayments).values({
          transactionId: createdTx.id,
          paymentMethod: 'CASH',
          amount: subtotalSell.toFixed(2),
          cashReceived: subtotalSell.toFixed(2),
          changeAmount: '0.00',
          createdAt: txDate,
        });

        totalTransactionsCreated++;
      }
      txIndex++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`🎉 SUKSES! Total Transaksi Baru Terinjeksi: ${totalTransactionsCreated}`);
  console.log(`💵 Total Omzet Ditambahkan: Rp ${totalGrandOmzet.toLocaleString('id-ID')}`);
  console.log(`======================================================\n`);

  // 6. Verifikasi Laporan Keuangan
  console.log('🔍 Memverifikasi Laporan Keuangan 27 Agustus s/d 14 September 2026...');
  const range = resolveReportRange({
    dateFrom: '2026-08-27',
    dateTo: '2026-09-14',
  });
  const report = await getFinancialReport(range);

  console.log('📊 Ringkasan Laporan Terkini:');
  console.log(`   - Total Omzet: Rp ${report.summary.omzet.toLocaleString('id-ID')}`);
  console.log(`   - Omzet Tunai (Cash): Rp ${report.summary.omzetCash.toLocaleString('id-ID')}`);
  console.log(`   - Total HPP Terjual: Rp ${report.summary.hppTerjual.toLocaleString('id-ID')}`);
  console.log(`   - Laba Kotor: Rp ${report.summary.labaKotor.toLocaleString('id-ID')}`);
  console.log(`   - Alokasi Gaji (50%): Rp ${report.summary.alokasiGajiKaryawan.toLocaleString('id-ID')}`);
  console.log(`   - Laba Bersih (50%): Rp ${report.summary.labaBersih.toLocaleString('id-ID')}`);
  console.log(`   - Total Transaksi: ${report.summary.txCount}`);
}

main()
  .catch((err) => {
    console.error('❌ Gagal mengimpor batch:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
