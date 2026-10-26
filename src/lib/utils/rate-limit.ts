// =============================================================
// Smartkasir Perwira — Rate Limiter Utility
// Algoritma: Sliding Window Counter
//
// ARSITEKTUR: Adapter pattern — interface tunggal, dua implementasi:
//   1. InMemoryRateLimiter  — development & fallback
//   2. (Slot kosong) RedisRateLimiter — production scale
//
// KENAPA BUKAN PURE IN-MEMORY?
// Di Vercel serverless, setiap instance punya Map sendiri. Saat cold-start
// atau deploy baru, hitungan reset. Untuk production yang strict,
// ganti store ke Upstash Redis (lihat catatan di bawah).
//
// CARA UPGRADE KE REDIS (jika diperlukan):
//   1. npm install @upstash/ratelimit @upstash/redis
//   2. Tambahkan UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN ke .env.local
//   3. Implementasikan RedisRateLimiter di bawah dan swap di createRateLimiter()
//
// Untuk skala STARTUP (kampus, ~5-20 kasir concurrent), implementasi
// in-memory ini CUKUP sebagai defense layer pertama. Brute force dari
// IP berbeda masih bisa terdeteksi di Vercel Analytics / WAF level.
// =============================================================

// ── Types ──────────────────────────────────────────────────────
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp ms
  retryAfterSeconds: number;
};

export interface RateLimiterStore {
  /**
   * Check apakah key masih di bawah limit.
   * Jika `consume = true`, sekaligus decrement counter.
   */
  check(key: string, consume?: boolean): RateLimitResult;
  /** Reset counter untuk key tertentu (biasanya setelah login sukses) */
  reset(key: string): void;
}

// ── Sliding Window Entry ────────────────────────────────────────
type WindowEntry = {
  count: number;
  windowStart: number; // Unix ms saat window dimulai
};

// ── InMemoryRateLimiter ─────────────────────────────────────────
// Singleton di-share antar request dalam 1 serverless instance.
// WARNING: Tidak persistent antar Vercel instances atau deploy.
class InMemoryRateLimiter implements RateLimiterStore {
  private readonly store = new Map<string, WindowEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs    = windowMs;
  }

  check(key: string, consume = true): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    // Jika tidak ada entry atau window sudah expire → buat baru
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (consume) {
        this.store.set(key, { count: 1, windowStart: now });
      }
      return {
        allowed: true,
        remaining: this.maxRequests - (consume ? 1 : 0),
        resetAt: now + this.windowMs,
        retryAfterSeconds: 0,
      };
    }

    // Window masih aktif
    const remaining = this.maxRequests - entry.count;

    if (remaining <= 0) {
      const resetAt = entry.windowStart + this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.ceil((resetAt - now) / 1000),
      };
    }

    // Masih ada quota — consume jika diminta
    if (consume) {
      entry.count += 1;
    }

    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.windowStart + this.windowMs,
      retryAfterSeconds: 0,
    };
  }

  reset(key: string): void {
    this.store.delete(key);
  }
}

// ── Factory ─────────────────────────────────────────────────────
// Singleton per konfigurasi — tidak buat instance baru setiap request

const _instances = new Map<string, RateLimiterStore>();

/**
 * Buat atau ambil singleton RateLimiter berdasarkan konfigurasi.
 * @param name       - Nama unik limiter (prefix untuk key isolation)
 * @param maxRequests - Maksimum request per window
 * @param windowMs   - Durasi window dalam milidetik
 *
 * @example
 * const limiter = createRateLimiter('auth:admin', 10, 60 * 60 * 1000);
 * const result = limiter.check(`login:${nidn}`);
 * if (!result.allowed) return apiError('Rate limited', 429);
 */
export function createRateLimiter(
  name: string,
  maxRequests: number,
  windowMs: number,
): RateLimiterStore {
  const cacheKey = `${name}:${maxRequests}:${windowMs}`;
  if (!_instances.has(cacheKey)) {
    // Slot untuk swap implementasi:
    // Jika UPSTASH_REDIS_REST_URL ada di env → bisa instansiasi RedisRateLimiter
    // Untuk sekarang: selalu InMemory (startup scale = cukup)
    _instances.set(cacheKey, new InMemoryRateLimiter(maxRequests, windowMs));
  }
  return _instances.get(cacheKey)!;
}

// ── Pre-configured Limiters ─────────────────────────────────────
// Gunakan ini langsung di route handlers

// ─────────────────────────────────────────────────────────────────────────────
// KEBIJAKAN RATE LIMIT SMARTKASIR PERWIRA
//
// ADMIN (Dosen Pembimbing)
//   Limit: 10 percobaan / 1 jam / per NIDN
//   Alasan: 1 orang admin — akses sangat sensitif (data HPP, laporan, karyawan)
//   10x sudah lebih dari cukup untuk typo normal. Strict intentional.
//
// KASIR (Mahasiswa)
//   Limit: 25 percobaan / 30 menit / per NIM
//   Alasan khusus UKM kasir:
//     - Pergantian shift: kasir login-logout bergantian, sering typo nama (kapital, spasi)
//     - Ijin pindah shift: kasir beda jam login di waktu yang berdekatan
//     - Ijin tidak berangkat: admin manual re-assign, kasir pengganti butuh beberapa percobaan
//     - Window 30 menit (bukan 1 jam) agar counter reset cepat pasca shift selesai
//     - 25x masih tergolong aman vs brute-force (kombinasi Nama+NIM+Prodi = sangat besar)
// ─────────────────────────────────────────────────────────────────────────────

/** Admin login: 10 percobaan / 1 jam / per NIDN — strict, 1 dosen */
export const adminAuthLimiter = createRateLimiter(
  'auth:admin',
  10,
  60 * 60 * 1000, // 1 jam
);

/**
 * Kasir login: 25 percobaan / 30 menit / per NIM
 * Lebih longgar karena skenario shift UKM (pergantian, ijin, salah ketik nama).
 * Window 30 menit agar counter reset cepat setelah shift berakhir.
 */
export const kasirAuthLimiter = createRateLimiter(
  'auth:kasir',
  25,
  30 * 60 * 1000, // 30 menit
);

/**
 * Pengajuan Pindah Shift (Swap): 3 pengajuan / 7 hari / per NIM
 *
 * KENAPA SANGAT KETAT?
 * Setiap swap yang di-APPROVE dosen memicu:
 *   1. UPDATE shift_schedules (2 baris — swap employeeId)
 *   2. INSERT attendance records (2 baris PENGGANTI)
 *   3. Jika sudah ada transaksi di shift itu → laporan berubah
 *   4. Audit log entry
 *
 * Mahasiswa dengan 3 swap/minggu sudah sangat akomodatif untuk
 * kondisi kampus. Lebih dari itu = indikasi penyalahgunaan.
 * Admin selalu bisa reset manual jika ada kondisi luar biasa.
 */
export const swapRequestLimiter = createRateLimiter(
  'swap:request',
  3,
  7 * 24 * 60 * 60 * 1000, // 7 hari
);

/**
 * Submit Draft Penerimaan Barang: 10 submit / 24 jam / per employee
 * Mencegah spam pembuatan draft barang masuk yang belum siap atau flood attack.
 */
export const stockSubmitLimiter = createRateLimiter(
  'stock:submit',
  10,
  24 * 60 * 60 * 1000, // 24 jam
);

/**
 * Submit Laporan Kondisi FEFO: 50 submit / 24 jam / per employee
 * Cukup fleksibel untuk pelaporan banyak batch sekaligus namun mencegah automated abuse.
 */
export const conditionReportLimiter = createRateLimiter(
  'condition:report',
  50,
  24 * 60 * 60 * 1000, // 24 jam
);

// =============================================================
// WIRAMART BUYER RATE LIMITERS
// Ditambahkan v2.0 — tidak mengubah limiter existing di atas
// =============================================================

/**
 * Buyer registrasi: 3 akun baru / 1 jam / per IP
 * Mencegah pembuatan akun massal (spam, bot).
 * 3x cukup untuk kondisi normal (salah ketik NIM/WA → coba ulang).
 */
export const buyerRegisterLimiter = createRateLimiter(
  'buyer:register',
  3,
  60 * 60 * 1000, // 1 jam
);

/**
 * Buyer login: 10 percobaan / 15 menit / per NIM
 * Agak lebih longgar dari admin karena tidak ada password.
 * Proteksi dari enumeration attack (coba-coba NIM orang lain).
 */
export const buyerLoginLimiter = createRateLimiter(
  'buyer:login',
  10,
  15 * 60 * 1000, // 15 menit
);

/**
 * Buyer buat pesanan: 5 order / 24 jam / per buyer_id
 * Mencegah spam order. 5x sehari sangat cukup untuk buyer kampus.
 * Admin bisa reset manual jika ada kondisi luar biasa.
 */
export const buyerOrderLimiter = createRateLimiter(
  'buyer:order',
  5,
  24 * 60 * 60 * 1000, // 24 jam
);

/**
 * Upload bukti transfer: 3 upload / 1 jam / per buyer_id
 * Mencegah flood upload storage. Buyer yang salah upload punya 3 kesempatan.
 * Jika habis: hubungi admin langsung via WA.
 */
export const buyerUploadLimiter = createRateLimiter(
  'buyer:upload',
  3,
  60 * 60 * 1000, // 1 jam
);
