// =============================================================
// GET /api/admin/produk/usulan — Ambil daftar usulan produk kasir
// POST /api/admin/produk/usulan — Review usulan (Setujui / Tolak)
// Auth: Admin only
// K2 & K8: HPP ditentukan Gudang/Admin, Harga Jual otomatis = HPP * (1 + margin%)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { productProposals, products, categories, employees, qrisSettings } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const SETTINGS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

// ── GET: Daftar usulan produk ────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') ?? 'PENDING';

  try {
    const rows = await db
      .select({
        id: productProposals.id,
        name: productProposals.name,
        barcode: productProposals.barcode,
        unit: productProposals.unit,
        photoUrl: productProposals.photoUrl,
        status: productProposals.status,
        adminNote: productProposals.adminNote,
        createdAt: productProposals.createdAt,
        categoryId: productProposals.categoryId,
        categoryName: categories.name,
        proposedBy: {
          id: employees.id,
          fullName: employees.fullName,
          nim: employees.nim,
          programStudi: employees.programStudi,
        },
      })
      .from(productProposals)
      .leftJoin(categories, eq(productProposals.categoryId, categories.id))
      .leftJoin(employees, eq(productProposals.proposedByEmployeeId, employees.id))
      .where(statusFilter !== 'ALL' ? eq(productProposals.status, statusFilter as 'PENDING' | 'APPROVED' | 'REJECTED') : undefined)
      .orderBy(desc(productProposals.createdAt))
      .limit(100);

    // Ambil juga setting margin global saat ini untuk bantuan hitung di antarmuka admin
    const settings = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, SETTINGS_SINGLETON_ID),
      columns: { globalMarginPercentage: true },
    });

    const globalMargin = settings?.globalMarginPercentage ? Number(settings.globalMarginPercentage) : 20;

    return apiOk({
      proposals: rows,
      globalMargin,
    });
  } catch (err) {
    console.error('[admin/produk/usulan GET]', err);
    return apiError('Gagal memuat usulan produk.', 500);
  }
}

// ── POST: Review usulan (APPROVE atau REJECT) ────────────────
const ReviewSchema = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(['APPROVE', 'REJECT']),
  costPrice: z.number().positive('HPP harus lebih dari 0').optional(),
  sellingPrice: z.number().positive('Harga jual harus lebih dari 0').optional(),
  stockQty: z.number().int().nonnegative().default(0),
  adminNote: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  const adminId = payload.sub;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 400);
  }

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { proposalId, action, costPrice, sellingPrice, stockQty, adminNote } = parsed.data;

  const proposal = await db.query.productProposals.findFirst({
    where: eq(productProposals.id, proposalId),
  });

  if (!proposal) {
    return apiError('Usulan produk tidak ditemukan', 404);
  }

  if (proposal.status !== 'PENDING') {
    return apiError(`Usulan sudah diproses sebelumnya (${proposal.status}).`, 409);
  }

  if (action === 'REJECT') {
    await db
      .update(productProposals)
      .set({
        status: 'REJECTED',
        adminNote: adminNote ?? 'Usulan ditolak oleh Admin/Gudang.',
        reviewedByAdminId: adminId,
        updatedAt: new Date(),
      })
      .where(eq(productProposals.id, proposalId));

    return apiOk({ message: 'Usulan produk berhasil ditolak.' });
  }

  // ── ACTION: APPROVE ──────────────────────────────────────────
  if (!costPrice) {
    return apiError('HPP wajib diisi untuk menyetujui produk baru.', 422);
  }

  // Ambil margin global
  const settings = await db.query.qrisSettings.findFirst({
    where: eq(qrisSettings.id, SETTINGS_SINGLETON_ID),
    columns: { globalMarginPercentage: true },
  });
  const globalMargin = settings?.globalMarginPercentage ? Number(settings.globalMarginPercentage) : 20;

  // Jika sellingPrice tidak diisi, otomatis hitung dari HPP * (1 + margin%)
  // Dibulatkan ke atas kelipatan Rp 100 agar kasir mudah memberi kembalian
  const calculatedSelling = sellingPrice ?? Math.ceil((costPrice * (1 + globalMargin / 100)) / 100) * 100;

  // Masukkan ke katalog produk resmi
  const [newProduct] = await db
    .insert(products)
    .values({
      name: proposal.name,
      categoryId: proposal.categoryId,
      barcode: proposal.barcode,
      unit: proposal.unit,
      photoUrl: proposal.photoUrl,
      costPrice: String(costPrice),
      sellingPrice: String(calculatedSelling),
      stockQty: stockQty,
      isActive: true,
      createdByAdminId: adminId,
    })
    .returning({ id: products.id, name: products.name });

  // Update proposal jadi APPROVED
  await db
    .update(productProposals)
    .set({
      status: 'APPROVED',
      approvedProductId: newProduct.id,
      adminNote: adminNote ?? `Disetujui. HPP: Rp ${costPrice.toLocaleString('id-ID')}, Harga Jual: Rp ${calculatedSelling.toLocaleString('id-ID')}`,
      reviewedByAdminId: adminId,
      updatedAt: new Date(),
    })
    .where(eq(productProposals.id, proposalId));

  return apiOk({
    message: `Produk "${newProduct.name}" berhasil disetujui dan dirilis ke katalog kasir!`,
    product: newProduct,
  });
}
