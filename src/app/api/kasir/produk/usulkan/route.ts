// =============================================================
// /api/kasir/produk/usulkan — Usulan Produk Baru oleh Kasir (K8)
// GET: Ambil daftar usulan produk oleh kasir yang sedang login
// POST: Ajukan usulan produk baru (HPP dan harga jual diisi Gudang/Admin)
// Auth: Employee JWT required
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { productProposals, categories, products } from '@/lib/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ── GET: Riwayat usulan produk kasir ─────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const employeeId = payload.sub as string;

  try {
    const proposals = await db
      .select({
        id: productProposals.id,
        name: productProposals.name,
        barcode: productProposals.barcode,
        unit: productProposals.unit,
        photoUrl: productProposals.photoUrl,
        status: productProposals.status,
        adminNote: productProposals.adminNote,
        createdAt: productProposals.createdAt,
        categoryName: categories.name,
      })
      .from(productProposals)
      .leftJoin(categories, eq(productProposals.categoryId, categories.id))
      .where(eq(productProposals.proposedByEmployeeId, employeeId))
      .orderBy(desc(productProposals.createdAt))
      .limit(50);

    return apiOk(proposals);
  } catch (err) {
    console.error('[kasir/produk/usulkan GET]', err);
    return apiError('Gagal memuat usulan produk.', 500);
  }
}

// ── POST: Kasir mengajukan usulan produk baru ─────────────────
const ProposeSchema = z.object({
  name: z.string().min(2, 'Nama produk minimal 2 karakter').max(200).trim(),
  categoryId: z.string().uuid('Kategori wajib dipilih'),
  barcode: z.string().max(50).optional().nullable(),
  unit: z.string().max(20).default('pcs'),
  photoUrl: z.string().url().optional().nullable(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const employeeId = payload.sub as string;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request JSON tidak valid.', 400);
  }

  const parsed = ProposeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { name, categoryId, barcode, unit, photoUrl } = parsed.data;

  // Cek jika barcode sudah terdaftar di produk aktif
  if (barcode) {
    const existingActive = await db.query.products.findFirst({
      where: and(eq(products.barcode, barcode), isNull(products.deletedAt)),
      columns: { id: true, name: true },
    });

    if (existingActive) {
      return apiError(`Barcode ${barcode} sudah terdaftar pada produk: ${existingActive.name}`, 409);
    }
  }

  try {
    const [proposal] = await db
      .insert(productProposals)
      .values({
        name,
        categoryId,
        barcode: barcode || null,
        unit: unit || 'pcs',
        photoUrl: photoUrl || null,
        proposedByEmployeeId: employeeId,
        status: 'PENDING',
      })
      .returning({
        id: productProposals.id,
        name: productProposals.name,
        status: productProposals.status,
        createdAt: productProposals.createdAt,
      });

    return apiOk({
      message: 'Usulan produk berhasil dikirim! Menunggu penentuan HPP dan persetujuan oleh Gudang / Admin.',
      proposal,
    }, 201);
  } catch (err) {
    console.error('[kasir/produk/usulkan POST]', err);
    return apiError('Gagal mengirim usulan produk.', 500);
  }
}
