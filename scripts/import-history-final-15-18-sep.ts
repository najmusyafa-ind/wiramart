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
import { resolveReportRange, getFinancialReport } from '../src/lib/finance/report';

interface Entry {
  name: string;
  qty: number;
  price: number;
  subtotal: number;
  method: 'CASH' | 'QRIS';
  minuteOffset: number;
  costPrice?: number;
}

interface DayBatch {
  date: string; // YYYY-MM-DD
  modalAwal: number;
  actualCashExpected: number;
  cashierName: string;
  employeeFilter: string;
  notes: string;
  cashMovements?: Array<{
    type: 'CASH_OUT' | 'CASH_IN';
    amount: number;
    category: string;
    notes: string;
  }>;
  entries: Entry[];
}

// ── 1. DEFINISI TRANSAKSI LENGKAP 15 s/d 18 SEPTEMBER 2026 ────────

export const BATCHES: DayBatch[] = [
  // ── 15 SEPTEMBER 2026 ──
  {
    date: '2026-09-15',
    modalAwal: 80500,
    actualCashExpected: 352000,
    cashierName: 'Annisa Salsabila & Najua Nur Salsabila',
    employeeFilter: 'annisa',
    notes: 'Piket 15 Sep: Annisa, Faizah, Ratih, Najua, Liliyana (Cash: 352k, QRIS: 198k)',
    entries: [
      // Hal 1
      { name: 'Nasi Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 10 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 15 },
      { name: 'Nasi Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 20 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 25 },
      { name: 'Nasi Krawu', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 30 },
      { name: 'Sprite lemon & jeruk nipis', qty: 2, price: 5000, subtotal: 10000, method: 'CASH', minuteOffset: 35 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 40 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 45 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 50 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 55 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 60 },
      { name: 'Kripca', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 65 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 70 },
      { name: 'Nasi Krawu', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 75 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 80 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 85 },
      { name: 'Nasi Bakar', qty: 2, price: 8000, subtotal: 16000, method: 'QRIS', minuteOffset: 90 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'QRIS', minuteOffset: 95 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 100 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 105 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 110 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 115 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 120 },
      { name: 'Smoothies', qty: 1, price: 27000, subtotal: 27000, method: 'QRIS', minuteOffset: 125 },
      { name: 'Matcha', qty: 1, price: 15000, subtotal: 15000, method: 'QRIS', minuteOffset: 130 },

      // Hal 2
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, method: 'QRIS', minuteOffset: 135 },
      { name: 'Matcha', qty: 1, price: 15000, subtotal: 15000, method: 'CASH', minuteOffset: 140 },
      { name: 'Real Good', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 145 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 150 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 155 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 160 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 165 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 170 },
      { name: 'Lotte CHOCOPIE', qty: 2, price: 2500, subtotal: 5000, method: 'CASH', minuteOffset: 175 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 180 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 185 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 190 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 195 },
      { name: 'You-You Stick', qty: 2, price: 1500, subtotal: 3000, method: 'CASH', minuteOffset: 200 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 205 },
      { name: 'Pentol Pedas', qty: 1, price: 4000, subtotal: 4000, method: 'CASH', minuteOffset: 210 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 215 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 220 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 225 },
      { name: 'Ayam Geprek', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 230 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 235 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 240 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 245 },

      // Hal 3
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 250 },
      { name: 'Ayam Geprek', qty: 2, price: 10000, subtotal: 20000, method: 'QRIS', minuteOffset: 255 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 260 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 265 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 270 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 275 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 280 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 285 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 290 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 295 },
      { name: 'Kripca', qty: 5, price: 1000, subtotal: 5000, method: 'QRIS', minuteOffset: 300 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 305 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 310 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 315 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 320 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 325 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 330 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 335 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 340 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'CASH', minuteOffset: 345 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 350 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 355 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, method: 'CASH', minuteOffset: 360 },
      { name: 'Marshmallow Rainbow', qty: 2, price: 1000, subtotal: 2000, method: 'CASH', minuteOffset: 365 },
      { name: 'Garuda Rosta', qty: 2, price: 1000, subtotal: 2000, method: 'CASH', minuteOffset: 370 },

      // Hal 4
      { name: 'Mie Enak', qty: 2, price: 1000, subtotal: 2000, method: 'CASH', minuteOffset: 375 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'QRIS', minuteOffset: 380 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 385 },
      { name: 'Pentol Pedas', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 390 },
      { name: 'Kopi Kapal Api', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 395 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 400 },
      { name: 'Penyesuaian Kas / Rekap Fisik', qty: 1, price: 5000, subtotal: 5000, method: 'CASH', minuteOffset: 405 },
    ],
  },

  // ── 16 SEPTEMBER 2026 ──
  {
    date: '2026-09-16',
    modalAwal: 61500,
    actualCashExpected: 58500,
    cashierName: 'Dwi Lia Rahmania & Nur Asshifah',
    employeeFilter: 'dwi lia',
    notes: 'Piket 16 Sep: Dwi Lia & Nur Asshifah (Cash: 601.5k, QRIS: 206.5k, Titipan: -543k)',
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 543000,
        category: 'OPERASIONAL',
        notes: 'Bayar Titipan Konsinyasi (Pentol 80k, Geprek 108k, Bu Cici 125k, Mimix 90k, Tahu Telur 140k)',
      },
    ],
    entries: [
      // Hal 1 (1-25)
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 10 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 15 },
      { name: 'Karipap', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 20 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 25 },
      { name: 'Karipap', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 30 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'QRIS', minuteOffset: 35 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 40 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 45 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 50 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 55 },
      { name: 'Permen Relaxa', qty: 2, price: 250, subtotal: 500, method: 'CASH', minuteOffset: 60 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 65 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 70 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'QRIS', minuteOffset: 75 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 80 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 85 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 90 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 95 },
      { name: 'Paseo', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 100 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 105 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 110 },
      { name: 'Sushi', qty: 1, price: 12000, subtotal: 12000, method: 'QRIS', minuteOffset: 115 },
      { name: 'Mie Kremezz', qty: 2, price: 1500, subtotal: 3000, method: 'CASH', minuteOffset: 120 },
      { name: 'Chocolatos Rich', qty: 2, price: 2000, subtotal: 4000, method: 'QRIS', minuteOffset: 125 },
      { name: 'taro net seaweed', qty: 1, price: 2000, subtotal: 2000, method: 'QRIS', minuteOffset: 130 },

      // Hal 2 (26-50)
      { name: 'Chitato Lite', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 135 },
      { name: 'Duosus', qty: 1, price: 3000, subtotal: 3000, method: 'QRIS', minuteOffset: 140 },
      { name: 'Super Star Wafer', qty: 2, price: 1500, subtotal: 3000, method: 'QRIS', minuteOffset: 145 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 150 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 155 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 160 },
      { name: 'Pop Mie Goreng', qty: 1, price: 9000, subtotal: 9000, method: 'QRIS', minuteOffset: 165 },
      { name: 'Pilus Garuda', qty: 2, price: 500, subtotal: 1000, method: 'QRIS', minuteOffset: 170 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 175 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 180 },
      { name: 'Beng beng', qty: 3, price: 4000, subtotal: 12000, method: 'CASH', minuteOffset: 185 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 190 },
      { name: 'Roti Kopi', qty: 2, price: 7000, subtotal: 14000, method: 'CASH', minuteOffset: 195 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 200 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 205 },
      { name: 'Permen Relaxa', qty: 6, price: 250, subtotal: 1500, method: 'CASH', minuteOffset: 210 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 215 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 220 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 225 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 230 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 235 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 240 },
      { name: 'Sushi', qty: 1, price: 12000, subtotal: 12000, method: 'CASH', minuteOffset: 245 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 250 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'QRIS', minuteOffset: 255 },

      // Hal 3 (51-75)
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 260 },
      { name: 'Chitato Lite', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 265 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 270 },
      { name: 'Sushi', qty: 1, price: 12000, subtotal: 12000, method: 'CASH', minuteOffset: 275 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 280 },
      { name: 'Tahu Telur', qty: 2, price: 11000, subtotal: 22000, method: 'QRIS', minuteOffset: 285 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 290 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'QRIS', minuteOffset: 295 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 300 },
      { name: 'Ayam Geprek', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 305 },
      { name: 'Mie Enak', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 310 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 315 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 320 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 325 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 330 },
      { name: 'Kripca', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 335 },
      { name: 'Mie Enak', qty: 2, price: 500, subtotal: 1000, method: 'CASH', minuteOffset: 340 },
      { name: 'Makaroni Krispi', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 345 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 350 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 355 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 360 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 365 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 370 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 375 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 380 },

      // Hal 4 (76-100)
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 385 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 390 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, method: 'CASH', minuteOffset: 395 },
      { name: 'Matcha', qty: 1, price: 15000, subtotal: 15000, method: 'CASH', minuteOffset: 400 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 405 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 410 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 415 },
      { name: 'Roti Sosis', qty: 2, price: 1500, subtotal: 3000, method: 'CASH', minuteOffset: 420 },
      { name: 'Stik Kentang', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 425 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, method: 'CASH', minuteOffset: 430 },
      { name: 'Tahu Telur', qty: 1, price: 11000, subtotal: 11000, method: 'CASH', minuteOffset: 435 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 440 },
      { name: 'Duosus', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 445 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'CASH', minuteOffset: 450 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 455 },
      { name: 'Pangsit', qty: 2, price: 3000, subtotal: 6000, method: 'CASH', minuteOffset: 460 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 465 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'QRIS', minuteOffset: 470 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 475 },
      { name: 'Ayam Geprek', qty: 3, price: 10000, subtotal: 30000, method: 'CASH', minuteOffset: 480 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 485 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, method: 'QRIS', minuteOffset: 490 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'CASH', minuteOffset: 495 },
      { name: 'Roti Kopi', qty: 2, price: 7000, subtotal: 14000, method: 'CASH', minuteOffset: 500 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'CASH', minuteOffset: 505 },

      // Hal 5 (101-125)
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 510 },
      { name: 'Pangsit', qty: 4, price: 3000, subtotal: 12000, method: 'CASH', minuteOffset: 515 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, method: 'QRIS', minuteOffset: 520 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 525 },
      { name: 'Permen Relaxa', qty: 2, price: 250, subtotal: 500, method: 'CASH', minuteOffset: 530 },
      { name: 'Spring Roll Rice', qty: 1, price: 5000, subtotal: 5000, method: 'QRIS', minuteOffset: 535 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 540 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 545 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 550 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'QRIS', minuteOffset: 555 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 560 },
      { name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, method: 'CASH', minuteOffset: 565 },
      { name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 570 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, method: 'CASH', minuteOffset: 575 },
      { name: 'Real Good', qty: 2, price: 2000, subtotal: 4000, method: 'CASH', minuteOffset: 580 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 585 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 590 },
      { name: 'Duosus', qty: 1, price: 3000, subtotal: 3000, method: 'QRIS', minuteOffset: 595 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, method: 'QRIS', minuteOffset: 600 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'QRIS', minuteOffset: 605 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'QRIS', minuteOffset: 610 },
      { name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, method: 'QRIS', minuteOffset: 615 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 620 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 625 },
      { name: 'Stik Kentang', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 630 },
      { name: 'Penjualan Lanjutan No. 126+ (Cash)', qty: 1, price: 33000, subtotal: 33000, method: 'CASH', minuteOffset: 635 },
      { name: 'Penjualan Lanjutan No. 126+ (QRIS)', qty: 1, price: 6500, subtotal: 6500, method: 'QRIS', minuteOffset: 640 },
    ],
  },

  // ── 17 SEPTEMBER 2026 ──
  {
    date: '2026-09-17',
    modalAwal: 58500,
    actualCashExpected: 276000,
    cashierName: 'Devi Yuliana Sari & Putri Solichatun',
    employeeFilter: 'devi',
    notes: 'Piket 17 Sep: Devi, Putri, Gita, Erika, Aprianti (Cash: 364k, QRIS: 106.5k, Bayar Titipan: -88k)',
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 88000,
        category: 'OPERASIONAL',
        notes: 'Bayar Titipan Konsinyasi (Nota 27)',
      },
    ],
    entries: [
      // Hal 1 (1-25)
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 10 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 15 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 20 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 25 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 30 },
      { name: 'Bery Biskuit Kentang', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 35 },
      { name: 'Mie Enak', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 40 },
      { name: 'Pilus Garuda', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 45 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 50 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 55 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'QRIS', minuteOffset: 60 },
      { name: 'Spring Roll Rice', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 65 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 70 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 75 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 80 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 85 },
      { name: 'Pop Mie Kuah', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 90 },
      { name: 'Ayam Pedas', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 95 },
      { name: 'Ayam Lada Hitam', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 100 },
      { name: 'Nasi Ayam Pedas', qty: 1, price: 8000, subtotal: 8000, method: 'QRIS', minuteOffset: 105 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 110 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 115 },
      { name: 'Nasi Ayam Pedas', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 120 },
      { name: 'Nasi Ayam Pedas', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 125 },
      { name: 'Nasi Ayam Pedas', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 130 },

      // Hal 2 (26-50)
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 135 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 140 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 145 },
      { name: 'Pilus Garuda', qty: 2, price: 500, subtotal: 1000, method: 'CASH', minuteOffset: 150 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 155 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 160 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 165 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 170 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'CASH', minuteOffset: 175 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 180 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 185 },
      { name: 'Nasi Krawu', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 190 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 195 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 200 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 205 },
      { name: 'Chitato Lite', qty: 2, price: 2500, subtotal: 5000, method: 'CASH', minuteOffset: 210 },
      { name: 'Pangsit', qty: 2, price: 3000, subtotal: 6000, method: 'CASH', minuteOffset: 215 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 220 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 225 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 230 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 235 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 240 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 245 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 250 },
      { name: 'Real Good', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 255 },

      // Hal 3 (51-75)
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 260 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 265 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 270 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 275 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 280 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 285 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 290 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 295 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 300 },
      { name: 'Super Star Wafer', qty: 2, price: 1500, subtotal: 3000, method: 'CASH', minuteOffset: 305 },
      { name: 'Pilus Garuda', qty: 2, price: 500, subtotal: 1000, method: 'CASH', minuteOffset: 310 },
      { name: 'Nasi Krawu', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 315 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, method: 'CASH', minuteOffset: 320 },
      { name: 'Kripca', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 325 },
      { name: 'Beng beng', qty: 1, price: 4000, subtotal: 4000, method: 'CASH', minuteOffset: 330 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 335 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 340 },
      { name: 'Nougat Kacang', qty: 1, price: 5000, subtotal: 5000, method: 'QRIS', minuteOffset: 345 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 350 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 355 },
      { name: 'Pilus Garuda', qty: 3, price: 500, subtotal: 1500, method: 'CASH', minuteOffset: 360 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 2, price: 3500, subtotal: 7000, method: 'QRIS', minuteOffset: 365 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 370 },
      { name: 'Nasi Krawu', qty: 2, price: 10000, subtotal: 20000, method: 'CASH', minuteOffset: 375 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 380 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 385 },

      // Hal 4 (76-88)
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 390 },
      { name: 'Keju Cake', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 395 },
      { name: 'Makaroni Krispi', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 400 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 405 },
      { name: 'Oishi caramel popcorn', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 410 },
      { name: 'Roti Kopi', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 415 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 420 },
      { name: 'Pilus Garuda', qty: 3, price: 500, subtotal: 1500, method: 'CASH', minuteOffset: 425 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 430 },
      { name: 'Garuda Rosta', qty: 2, price: 1000, subtotal: 2000, method: 'CASH', minuteOffset: 435 },
      { name: 'Pilus Garuda', qty: 4, price: 500, subtotal: 2000, method: 'CASH', minuteOffset: 440 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 445 },
      { name: 'Mie Kremezz', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 450 },
      { name: 'Penyesuaian Kas / Lebihan', qty: 1, price: 5000, subtotal: 5000, method: 'CASH', minuteOffset: 455 }, // Selisih 5.000 agar klop 364.000
    ],
  },

  // ── 18 SEPTEMBER 2026 ──
  {
    date: '2026-09-18',
    modalAwal: 276000,
    actualCashExpected: 40000,
    cashierName: 'Zahara Nurrohmah & Nova Ade Riyana',
    employeeFilter: 'zahara',
    notes: 'Piket 18 Sep: Zahara, Nova, Dea, Agus (Cash: 318k, QRIS: 84k, Ambil Titipan: -190k, Sisa Kas Laci: 40k). Rekap: 21/9/26 B. Dyah Ambil 200.000',
    cashMovements: [
      {
        type: 'CASH_OUT',
        amount: 190000,
        category: 'OPERASIONAL',
        notes: 'Bayar Titipan Makanan (Geprek 45k, Nasi Bakar 35k, Spring Roll 14k, Roti Sosis 48k, Roti Oke 48k)',
      },
    ],
    entries: [
      // Hal 1 (1-25)
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 10 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 15 },
      { name: 'Sprite lemon & jeruk nipis', qty: 1, price: 5000, subtotal: 5000, method: 'CASH', minuteOffset: 20 },
      { name: 'Coca Cola 390ml', qty: 7, price: 5000, subtotal: 35000, method: 'CASH', minuteOffset: 25 },
      { name: 'Chocolatos Wafer Roll', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 30 },
      { name: 'Isotonic ion Power Ade', qty: 2, price: 6000, subtotal: 12000, method: 'CASH', minuteOffset: 35 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'QRIS', minuteOffset: 40 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 45 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 50 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 55 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 60 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 65 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'CASH', minuteOffset: 70 },
      { name: 'You-You Stick', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 75 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 80 },
      { name: 'Nabati Sip Coklat', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 85 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 90 },
      { name: 'Stik Kentang', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 95 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 100 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 105 },
      { name: 'Ayam Geprek', qty: 2, price: 10000, subtotal: 20000, method: 'QRIS', minuteOffset: 110 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'QRIS', minuteOffset: 115 },
      { name: 'Roti Sosis', qty: 2, price: 7000, subtotal: 14000, method: 'CASH', minuteOffset: 120 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 125 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 130 },

      // Hal 2 (26-50)
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 135 },
      { name: 'Spring Roll Mie', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 140 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 145 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'CASH', minuteOffset: 150 },
      { name: 'Pop Mie Goreng', qty: 1, price: 9000, subtotal: 9000, method: 'QRIS', minuteOffset: 155 },
      { name: 'Ayam Geprek', qty: 1, price: 10000, subtotal: 10000, method: 'QRIS', minuteOffset: 160 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 165 },
      { name: 'Nutriboost Jeruk', qty: 1, price: 7500, subtotal: 7500, method: 'CASH', minuteOffset: 170 },
      { name: 'Roti Oke', qty: 2, price: 7000, subtotal: 14000, method: 'CASH', minuteOffset: 175 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 180 },
      { name: 'Roti Oke', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 185 },
      { name: 'Roti Sosis', qty: 1, price: 7000, subtotal: 7000, method: 'QRIS', minuteOffset: 190 },
      { name: 'Chitato', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 195 },
      { name: 'Nasi Bakar', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 200 },
      { name: 'Super Star Wafer', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 205 },
      { name: 'Kripca', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 210 },
      { name: 'Lotte CHOCOPIE', qty: 1, price: 2500, subtotal: 2500, method: 'CASH', minuteOffset: 215 },
      { name: 'Mie Kremezz', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 220 },
      { name: 'Pangsit', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 225 },
      { name: 'Stik Kentang', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 230 },
      { name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, method: 'QRIS', minuteOffset: 235 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 240 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 245 },
      { name: 'Kuaci Rebo Rasa Green Tea', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 250 },
      { name: 'Pulpy orange', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 255 },

      // Hal 3 (51-66)
      { name: 'frestea Melati+Leci', qty: 1, price: 4500, subtotal: 4500, method: 'CASH', minuteOffset: 260 },
      { name: 'Permen Relaxa', qty: 1, price: 500, subtotal: 500, method: 'CASH', minuteOffset: 265 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 270 },
      { name: 'Garuda Rosta', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 275 },
      { name: 'Kuaci Rebo Rasa Green Tea', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 280 },
      { name: 'Duosus', qty: 1, price: 3000, subtotal: 3000, method: 'CASH', minuteOffset: 285 },
      { name: 'Roti Sosis', qty: 3, price: 7000, subtotal: 21000, method: 'CASH', minuteOffset: 290 },
      { name: 'Protex', qty: 1, price: 1500, subtotal: 1500, method: 'CASH', minuteOffset: 295 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 300 },
      { name: 'Stik Kentang', qty: 1, price: 2000, subtotal: 2000, method: 'CASH', minuteOffset: 305 },
      { name: 'Coca Cola 390ml', qty: 1, price: 5000, subtotal: 5000, method: 'CASH', minuteOffset: 310 },
      { name: 'AIR MINERAL ADES ECO GREEN 600ML', qty: 1, price: 3500, subtotal: 3500, method: 'CASH', minuteOffset: 315 },
      { name: 'Roti Oke', qty: 2, price: 7000, subtotal: 14000, method: 'CASH', minuteOffset: 320 },
      { name: 'Nasi Bakar', qty: 2, price: 8000, subtotal: 16000, method: 'CASH', minuteOffset: 325 },
      { name: 'Isotonic ion Power Ade', qty: 1, price: 6000, subtotal: 6000, method: 'CASH', minuteOffset: 330 },
      { name: 'Pop Mie Kuah', qty: 1, price: 8000, subtotal: 8000, method: 'CASH', minuteOffset: 335 },
      { name: 'Penyesuaian Kas / Pembulatan Laci', qty: 1, price: 1000, subtotal: 1000, method: 'CASH', minuteOffset: 340 },
    ],
  },
];

async function runFinalImport() {
  console.log('🚀 Memulai Impor Riwayat Transaksi FINAL (15 s/d 18 September 2026)...');

  // 1. Ambil Admin & Karyawan
  const admin = await db.query.admins.findFirst({ where: eq(admins.isActive, true) });
  if (!admin) throw new Error('Admin tidak ditemukan');

  const allEmployees = await db.query.employees.findMany({ where: eq(employees.isActive, true) });
  const empMap = new Map<string, typeof allEmployees[0]>();
  for (const e of allEmployees) {
    const fn = e.fullName.toLowerCase();
    if (fn.includes('annisa')) empMap.set('annisa', e);
    if (fn.includes('dwi lia')) empMap.set('dwi lia', e);
    if (fn.includes('devi')) empMap.set('devi', e);
    if (fn.includes('zahara')) empMap.set('zahara', e);
  }

  const defaultEmp = allEmployees[0];

  // 2. Kategori Map
  const cats = await db.query.categories.findMany();
  const catMap = new Map<string, string>();
  for (const c of cats) {
    catMap.set(c.name.toLowerCase(), c.id);
  }
  const catMinumanId = catMap.get('minuman')!;
  const catMakananId = catMap.get('makanan')!;
  const catJajananId = catMap.get('jajanan')!;
  const catLainnyaId = catMap.get('lainnya')!;

  // 3. Pastikan Master Produk Baru Dibuat
  const masterToEnsure = [
    { name: 'Nasi Krawu', costPrice: '8000.00', sellingPrice: '10000.00', catId: catMakananId, isPerishable: true },
    { name: 'Roti Sosis', costPrice: '5500.00', sellingPrice: '7000.00', catId: catMakananId, isPerishable: true },
    { name: 'Kripca', costPrice: '700.00', sellingPrice: '1000.00', catId: catJajananId },
    { name: 'Smoothies', costPrice: '21000.00', sellingPrice: '27000.00', catId: catMinumanId },
    { name: 'Matcha', costPrice: '12000.00', sellingPrice: '15000.00', catId: catMinumanId },
    { name: 'Real Good', costPrice: '1500.00', sellingPrice: '2000.00', catId: catMinumanId },
    { name: 'You-You Stick', costPrice: '1000.00', sellingPrice: '1500.00', catId: catJajananId },
    { name: 'Roti Kopi', costPrice: '5500.00', sellingPrice: '7000.00', catId: catMakananId, isPerishable: true },
    { name: 'Pangsit', costPrice: '2000.00', sellingPrice: '3000.00', catId: catJajananId },
    { name: 'Garuda Rosta', costPrice: '700.00', sellingPrice: '1000.00', catId: catJajananId },
    { name: 'Kopi Kapal Api', costPrice: '1800.00', sellingPrice: '2500.00', catId: catMinumanId },
    { name: 'Karipap', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Tahu Telur', costPrice: '9000.00', sellingPrice: '11000.00', catId: catMakananId, isPerishable: true },
    { name: 'Sushi', costPrice: '9500.00', sellingPrice: '12000.00', catId: catMakananId, isPerishable: true },
    { name: 'Paseo', costPrice: '1500.00', sellingPrice: '2000.00', catId: catLainnyaId },
    { name: 'Chocolatos Rich', costPrice: '3000.00', sellingPrice: '4000.00', catId: catJajananId },
    { name: 'Chitato Lite', costPrice: '2000.00', sellingPrice: '2500.00', catId: catJajananId },
    { name: 'Pop Mie Goreng', costPrice: '7000.00', sellingPrice: '9000.00', catId: catMakananId },
    { name: 'Spring Roll Mie', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Spring Roll Rice', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Bery Biskuit Kentang', costPrice: '700.00', sellingPrice: '1000.00', catId: catJajananId },
    { name: 'Ayam Pedas', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Nasi Ayam Pedas', costPrice: '6500.00', sellingPrice: '8000.00', catId: catMakananId, isPerishable: true },
    { name: 'Nougat Kacang', costPrice: '3500.00', sellingPrice: '5000.00', catId: catJajananId },
    { name: 'Protex', costPrice: '1000.00', sellingPrice: '1500.00', catId: catLainnyaId },
    { name: 'Stik Kentang', costPrice: '1500.00', sellingPrice: '2000.00', catId: catJajananId },
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

  let totalTxInjected = 0;
  let totalGrandOmzet = 0;

  // 5. Eksekusi per Hari
  for (const day of BATCHES) {
    const dayOmzet = day.entries.reduce((a, b) => a + b.subtotal, 0);
    const dayCash = day.entries.filter((e) => e.method === 'CASH').reduce((a, b) => a + b.subtotal, 0);
    const dayQris = day.entries.filter((e) => e.method === 'QRIS').reduce((a, b) => a + b.subtotal, 0);
    totalGrandOmzet += dayOmzet;

    console.log(`\n📅 Memproses ${day.date}: ${day.cashierName}`);
    console.log(`   💵 Target: Total Rp ${dayOmzet.toLocaleString('id-ID')} (Cash: Rp ${dayCash.toLocaleString('id-ID')}, QRIS: Rp ${dayQris.toLocaleString('id-ID')})`);

    const chosenEmp = empMap.get(day.employeeFilter) || defaultEmp;
    const shiftClockIn = new Date(`${day.date}T07:30:00+07:00`);
    const shiftClockOut = new Date(`${day.date}T17:00:00+07:00`);

    // Dapatkan / Buat Shift
    let [existingShift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.employeeId, chosenEmp.id),
          sql`DATE(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta') = ${day.date}::date`
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
          console.log(`   💸 Kas Gerak: ${cm.type} Rp ${cm.amount.toLocaleString('id-ID')} (${cm.notes})`);
        }
      }
    }

    // Insert Transaksi
    let txIdx = 1;
    for (const entry of day.entries) {
      let prodInfo = prodDict.get(entry.name);
      if (!prodInfo) {
        for (const [pName, pVal] of Array.from(prodDict.entries())) {
          if (pName.toLowerCase() === entry.name.toLowerCase()) {
            prodInfo = pVal;
            break;
          }
        }
      }
      if (!prodInfo) {
        const [newP] = await db
          .insert(products)
          .values({
            name: entry.name,
            costPrice: (entry.price * 0.75).toFixed(2),
            sellingPrice: entry.price.toFixed(2),
            stockQty: 0,
            unit: 'pcs',
            categoryId: catJajananId,
            createdByAdminId: admin.id,
          })
          .returning({ id: products.id, costPrice: products.costPrice });
        prodInfo = { id: newP.id, costPrice: Number(newP.costPrice) };
        prodDict.set(entry.name, prodInfo);
        console.log(`   ✨ Auto-Created: "${entry.name}"`);
      }

      const txDate = new Date(`${day.date}T08:00:00+07:00`);
      txDate.setMinutes(txDate.getMinutes() + entry.minuteOffset);

      const invSuffix = `${day.date.replace(/-/g, '')}-${entry.method === 'QRIS' ? 'QR' : 'CS'}-${String(txIdx).padStart(3, '0')}`;
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
            paymentMethod: entry.method,
            status: 'COMPLETED',
            grossAmount: subtotalSell.toFixed(2),
            totalHpp: subtotalCost.toFixed(2),
            grossProfit: grossProfit.toFixed(2),
            cashReceived: entry.method === 'CASH' ? subtotalSell.toFixed(2) : '0.00',
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
          paymentMethod: entry.method,
          amount: subtotalSell.toFixed(2),
          cashReceived: entry.method === 'CASH' ? subtotalSell.toFixed(2) : '0.00',
          changeAmount: '0.00',
          createdAt: txDate,
        });

        totalTxInjected++;
      }
      txIdx++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`🎉 SUKSES! Total Transaksi Batch 15-18 Sep Terinjeksi: ${totalTxInjected}`);
  console.log(`💵 Total Omzet Batch Ditambahkan: Rp ${totalGrandOmzet.toLocaleString('id-ID')}`);
  console.log(`======================================================\n`);

  // 6. Verifikasi Audit Komprehensif
  console.log('🔍 Menjalankan Audit Laporan Keuangan 15 Agustus s/d 18 September 2026...');
  const range = resolveReportRange({
    dateFrom: '2026-08-15',
    dateTo: '2026-09-18',
  });

  const report = await getFinancialReport(range);

  console.log('\n======================================================');
  console.log(`📊 LAPORAN KEUANGAN HISTORIS WIRAMART LENGKAP`);
  console.log(`Periode: ${range.label}`);
  console.log('======================================================');
  console.log(`💰 Total Omzet:             Rp ${report.summary.omzet.toLocaleString('id-ID')}`);
  console.log(`💵 Omzet Cash (Tunai):      Rp ${report.summary.omzetCash.toLocaleString('id-ID')}`);
  console.log(`📱 Omzet QRIS:              Rp ${report.summary.omzetQris.toLocaleString('id-ID')}`);
  console.log(`🧾 Total Transaksi Selesai: ${report.summary.txCount}`);
  console.log(`📦 Total HPP Terjual:       Rp ${report.summary.hppTerjual.toLocaleString('id-ID')}`);
  console.log(`📈 Laba Kotor:              Rp ${report.summary.labaKotor.toLocaleString('id-ID')}`);
  console.log(`👥 Alokasi Gaji (50%):      Rp ${report.summary.alokasiGajiKaryawan.toLocaleString('id-ID')}`);
  console.log(`🏢 Laba Bersih Hak Toko:    Rp ${report.summary.labaBersih.toLocaleString('id-ID')}`);
  console.log('======================================================\n');

  console.log('🛡️ Triple Integrity Checks:');
  console.log(`   - Method Split Matches:  ${report.checks.methodSplitMatches ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   - Items Match Omzet:     ${report.checks.itemsMatchOmzet ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   - Daily Matches Summary: ${report.checks.dailyMatchesSummary ? '✅ PASSED' : '❌ FAILED'}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('import-history-final-15-18-sep.ts')) {
  runFinalImport()
    .catch((err) => {
      console.error('❌ Gagal impor final:', err);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
