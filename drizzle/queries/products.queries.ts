/**
 * drizzle/queries/products.queries.ts — 商品管理查询
 */
import { eq, desc, and } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { products } from '../schema/products';
import { inventory } from '../schema/inventory';

/** 列出商品（LEFT JOIN inventory 获取库存量） */
export function listProducts(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: products.id,
    name: products.name,
    brand: products.brand,
    unit: products.unit,
    category1: products.category1,
    category2: products.category2,
    purchasePrice: products.purchasePrice,
    salePrice: products.salePrice,
    notes: products.notes,
    warningThreshold: products.warningThreshold,
    ownerId: products.ownerId,
    createdAt: products.createdAt,
    stock: inventory.quantity,
  }).from(products)
    .leftJoin(inventory, and(
      eq(inventory.productId, products.id),
      eq(inventory.ownerId, products.ownerId)
    ))
    .where(eq(products.ownerId, ownerId))
    .orderBy(desc(products.id));
}

/** 根据 ID 和 owner_id 查找商品 */
export function findProductById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 创建商品 */
export function createProduct(
  db: DrizzleDb,
  data: {
    name: string; brand?: string; unit?: string; category1: string;
    category2?: string; purchasePrice?: number; salePrice?: number;
    notes?: string; warningThreshold?: number; ownerId: number;
  }
) {
  return db.insert(products)
    .values({
      name: data.name,
      brand: data.brand || '',
      unit: data.unit || '件',
      category1: data.category1,
      category2: data.category2 || '',
      purchasePrice: data.purchasePrice || 0,
      salePrice: data.salePrice || 0,
      notes: data.notes || '',
      warningThreshold: data.warningThreshold || 0,
      ownerId: data.ownerId,
    })
    .returning({ id: products.id });
}

/** 更新商品 */
export function updateProduct(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: {
    name?: string; brand?: string; unit?: string; category1?: string;
    category2?: string; purchasePrice?: number; salePrice?: number;
    notes?: string; warningThreshold?: number;
  }
) {
  // Drizzle 的 .set() 不接受直接传递 undefined，需要动态构建更新对象
  const setData: Record<string, unknown> = {};
  if (data.name !== undefined) setData.name = data.name;
  if (data.brand !== undefined) setData.brand = data.brand;
  if (data.unit !== undefined) setData.unit = data.unit;
  if (data.category1 !== undefined) setData.category1 = data.category1;
  if (data.category2 !== undefined) setData.category2 = data.category2;
  if (data.purchasePrice !== undefined) setData.purchasePrice = data.purchasePrice;
  if (data.salePrice !== undefined) setData.salePrice = data.salePrice;
  if (data.notes !== undefined) setData.notes = data.notes;
  if (data.warningThreshold !== undefined) setData.warningThreshold = data.warningThreshold;
  if (Object.keys(setData).length === 0) return Promise.resolve();

  return db.update(products)
    .set(setData as any)
    .where(and(eq(products.id, id), eq(products.ownerId, ownerId)));
}

/** 删除商品 */
export function deleteProduct(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(products)
    .where(and(eq(products.id, id), eq(products.ownerId, ownerId)));
}
