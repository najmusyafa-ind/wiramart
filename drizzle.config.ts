import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// drizzle-kit CLI tidak baca .env.local secara otomatis (itu khusus Next.js runtime)
// Kita load manual di sini agar DATABASE_URL tersedia saat db:push / db:generate
dotenv.config({ path: '.env.local' });

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
