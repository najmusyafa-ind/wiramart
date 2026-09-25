// =============================================================
// Smartkasir Perwira — Drizzle DB Client (Supabase PostgreSQL)
// Singleton pattern — satu koneksi untuk seluruh aplikasi
// =============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Guard: pastikan DATABASE_URL ada sebelum koneksi dibuat
if (!process.env.DATABASE_URL) {
  throw new Error(
    '[DB] DATABASE_URL tidak ditemukan. Pastikan file .env.local sudah diisi.'
  );
}

// Singleton connection — mencegah multiple connection saat hot reload (dev)
// Pattern: global variable untuk development, new instance untuk production
const globalForDb = globalThis as unknown as {
  _dbConnection: ReturnType<typeof postgres> | undefined;
};

const connection =
  globalForDb._dbConnection ??
  postgres(process.env.DATABASE_URL, {
    max: 10,           // connection pool max — sesuai Supabase free tier
    idle_timeout: 20,  // tutup koneksi idle setelah 20 detik
    connect_timeout: 10,
    prepare: false,    // wajib false untuk Supabase transaction pooler
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb._dbConnection = connection;
}

export const db = drizzle(connection, { schema });

export type DB = typeof db;
