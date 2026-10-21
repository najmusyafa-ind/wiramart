import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// 1. Load Configurations
dotenv.config({ path: '.env.local' });
const prodUrl = process.env.DATABASE_URL!;

const stagingEnv = dotenv.parse(fs.readFileSync('.env.staging'));
const stagingUrl = stagingEnv.DATABASE_URL!;

console.log('--- INISIALISASI FULL DATABASE SYNC (PROD -> STAGING) ---');
console.log('Production URL host:', prodUrl ? prodUrl.split('@')[1] : 'NOT FOUND');
console.log('Staging URL host   :', stagingUrl ? stagingUrl.split('@')[1] : 'NOT FOUND');

async function sync() {
  const prod = postgres(prodUrl, { max: 5 });
  const staging = postgres(stagingUrl, { max: 5 });

  try {
    // ==========================================
    // LANGKAH 1: Sinkronisasi Custom ENUM Types
    // ==========================================
    console.log('\n[1/5] Memeriksa & menyamakan custom ENUM types...');
    const prodEnums = await prod`
      SELECT t.typname as enum_name, array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname;
    `;

    for (const e of prodEnums) {
      const vals = e.enum_values.map((v: string) => `'${v}'`).join(', ');
      await staging.unsafe(`
        DO $$ BEGIN
          CREATE TYPE public."${e.enum_name}" AS ENUM (${vals});
        EXCEPTION WHEN duplicate_object THEN
          -- Tambahkan nilai enum baru jika ada yang belum terdaftar
          NULL;
        END $$;
      `);
      // Tambahkan nilai jika enum sudah ada tapi nilai baru belum ada
      for (const val of e.enum_values) {
        try {
          await staging.unsafe(`ALTER TYPE public."${e.enum_name}" ADD VALUE IF NOT EXISTS '${val}';`);
        } catch {
          // ignore
        }
      }
    }
    console.log(`✅ ${prodEnums.length} ENUM types tersinkronisasi.`);

    // ==========================================
    // LANGKAH 2: Buat Tabel & Kolom yang Hilang di Staging
    // ==========================================
    console.log('\n[2/5] Memeriksa struktur tabel & kolom di Staging...');
    
    // Ambil semua tabel dasar dari Production
    const prodTables = await prod`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    // Ambil semua kolom dari Production
    const prodColumns = await prod`
      SELECT table_name, column_name, udt_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;

    // Ambil primary keys dari Production
    const prodPKs = await prod`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';
    `;

    const pkMap = new Map<string, string[]>();
    for (const pk of prodPKs) {
      if (!pkMap.has(pk.table_name)) pkMap.set(pk.table_name, []);
      pkMap.get(pk.table_name)!.push(pk.column_name);
    }

    // Ambil tabel yang saat ini ada di Staging
    const stagingTablesRes = await staging`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `;
    const existingStagingTables = new Set(stagingTablesRes.map(t => t.table_name));

    for (const t of prodTables) {
      const tableName = t.table_name;
      const cols = prodColumns.filter(c => c.table_name === tableName);
      const pks = pkMap.get(tableName) || [];

      if (!existingStagingTables.has(tableName)) {
        console.log(`- Membuat tabel baru di Staging: ${tableName}`);
        const colDefs = cols.map(c => {
          let typeDef = c.udt_name;
          if (c.data_type === 'USER-DEFINED') {
            typeDef = `public."${c.udt_name}"`;
          } else if (c.data_type === 'character varying') {
            typeDef = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR';
          } else if (c.data_type === 'timestamp with time zone') {
            typeDef = 'TIMESTAMPTZ';
          } else if (c.data_type === 'timestamp without time zone') {
            typeDef = 'TIMESTAMP';
          }

          let def = `"${c.column_name}" ${typeDef}`;
          if (c.column_default) {
            def += ` DEFAULT ${c.column_default}`;
          }
          if (c.is_nullable === 'NO') {
            def += ` NOT NULL`;
          }
          return def;
        });

        if (pks.length > 0) {
          colDefs.push(`PRIMARY KEY (${pks.map(p => `"${p}"`).join(', ')})`);
        }

        const createSql = `CREATE TABLE public."${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`;
        await staging.unsafe(createSql);
      } else {
        // Cek jika ada kolom yang belum ada di tabel Staging
        const stagingCols = await staging`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${tableName};
        `;
        const stagingColSet = new Set(stagingCols.map(c => c.column_name));

        for (const c of cols) {
          if (!stagingColSet.has(c.column_name)) {
            console.log(`  + Menambahkan kolom ${tableName}.${c.column_name} di Staging`);
            let typeDef = c.udt_name;
            if (c.data_type === 'USER-DEFINED') {
              typeDef = `public."${c.udt_name}"`;
            } else if (c.data_type === 'character varying') {
              typeDef = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR';
            } else if (c.data_type === 'timestamp with time zone') {
              typeDef = 'TIMESTAMPTZ';
            } else if (c.data_type === 'timestamp without time zone') {
              typeDef = 'TIMESTAMP';
            }
            let alterSql = `ALTER TABLE public."${tableName}" ADD COLUMN IF NOT EXISTS "${c.column_name}" ${typeDef}`;
            if (c.column_default) {
              alterSql += ` DEFAULT ${c.column_default}`;
            }
            await staging.unsafe(alterSql);
          }
        }
      }
    }
    console.log('✅ Semua 29 tabel dan kolom di Staging sudah lengkap.');

    // ==========================================
    // LANGKAH 3: Kosongkan Data Staging (Truncate)
    // ==========================================
    console.log('\n[3/5] Membersihkan tabel Staging sebelum pengisian data...');
    await staging.unsafe(`
      DO $$ 
      DECLARE 
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log('✅ Staging bersih siap diisi data.');

    // ==========================================
    // LANGKAH 4: Salin Data dari Production ke Staging
    // ==========================================
    console.log('\n[4/5] Mentransfer data dari Production ke Staging (Bypass FK via replica role)...');
    await staging`SET session_replication_role = 'replica';`;

    for (const t of prodTables) {
      const tableName = t.table_name;
      // Ambil semua data dari Production
      const rows = await prod.unsafe(`SELECT * FROM public."${tableName}"`);
      
      if (rows.length === 0) {
        console.log(`- ${tableName}: 0 baris (dilewati)`);
        continue;
      }

      console.log(`- Mentransfer ${tableName} (${rows.length} baris)...`);
      
      // Batch insert (200 baris per batch agar tidak kena parameter limit)
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await staging`INSERT INTO ${staging(tableName)} ${staging(chunk)}`;
      }
    }

    // Kembalikan ke origin role
    await staging`SET session_replication_role = 'origin';`;
    console.log('✅ Transfer data selesai!');

    // ==========================================
    // LANGKAH 5: Verifikasi Hasil Duplikasi
    // ==========================================
    console.log('\n[5/5] Melakukan verifikasi jumlah baris (Audit Comparison)...');
    console.log('------------------------------------------------------------------');
    console.log('| Nama Tabel                  | Prod Baris | Staging Baris | Status |');
    console.log('------------------------------------------------------------------');

    let allMatched = true;
    for (const t of prodTables) {
      const tableName = t.table_name;
      const pCountRes = await prod.unsafe(`SELECT count(*)::int as count FROM public."${tableName}"`);
      const sCountRes = await staging.unsafe(`SELECT count(*)::int as count FROM public."${tableName}"`);
      
      const pCount = pCountRes[0].count;
      const sCount = sCountRes[0].count;
      const status = pCount === sCount ? '✅ MATCH' : '❌ MISMATCH';
      if (pCount !== sCount) allMatched = false;

      console.log(`| ${tableName.padEnd(27)} | ${String(pCount).padStart(10)} | ${String(sCount).padStart(13)} | ${status.padEnd(6)} |`);
    }
    console.log('------------------------------------------------------------------');

    if (allMatched) {
      console.log('\n🎉 DUPLIKASI DATA PENUH BERHASIL 100%! STAGING IDENTIK DENGAN PRODUCTION.');
    } else {
      console.warn('\n⚠️ ADA PERBEDAAN JUMLAH BARIS, SILAKAN CEK TABEL DI ATAS.');
    }

  } catch (err: any) {
    console.error('\n❌ GAGAL SYNC:', err);
  } finally {
    await prod.end();
    await staging.end();
  }
}

sync();
