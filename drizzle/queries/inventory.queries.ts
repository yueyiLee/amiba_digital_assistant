/**
 * drizzle/queries/inventory.queries.ts — 库存管理查询
 */
import { eq, desc, and, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { inventory } from '../schema/inventory';
import { products } from '../schema/products';

/** 列出库存（JOIN products） */
export function listInventory(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: inventory.id,
    productId: inventory.productId,
    quantity: inventory.quantity,
    avgPrice: inventory.avgPrice,
    ownerId: inventory.ownerId,
    createdAt: inventory.createdAt,
    updatedAt: inventory.updatedAt,
    productName: products.name,
    category1: products.category1,
    category2: products.category2,
    purchasePrice: products.purchasePrice,
    salePrice: products.salePrice,
  }).from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(eq(inventory.ownerId, ownerId))
    .orderBy(inventory.id);
}

/** 根据 product_id 查找库存 */
export function findInventoryByProduct(db: DrizzleDb, productId: number, ownerId: number) {
  return db.select()
    .from(inventory)
    .where(and(eq(inventory.productId, productId), eq(inventory.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 根据 ID 查找库存 */
export function findInventoryById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(inventory)
    .where(and(eq(inventory.id, id), eq(inventory.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 创建库存记录 */
export function createInventory(
  db: DrizzleDb,
  data: { productId: number; quantity: number; avgPrice: number; ownerId: number }
) {
  return db.insert(inventory)
    .values({
      productId: data.productId,
      quantity: data.quantity,
      avgPrice: data.avgPrice,
      ownerId: data.ownerId,
    })
    .returning({ id: inventory.id });
}

/** 更新库存 */
export function updateInventory(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: { quantity: number; avgPrice?: number }
) {
  return db.update(inventory)
    .set({
      quantity: data.quantity,
      avgPrice: data.avgPrice,            // Drizzle 自动忽略 undefined，传入 null 或 undefined 均不会更新该列
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(inventory.id, id), eq(inventory.ownerId, ownerId)));
}

/** Upsert 库存（product_id + owner_id 维度） */
export async function upsertInventory(
  db: DrizzleDb,
  data: { productId: number; quantity: number; avgPrice: number; ownerId: number }
) {
  const exist = await findInventoryByProduct(db, data.productId, data.ownerId);
  if (exist) {
    return updateInventory(db, exist.id, data.ownerId, { quantity: data.quantity, avgPrice: data.avgPrice });
  } else {
    return createInventory(db, data);
  }
}

/** 删除库存 */
export function deleteInventory(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(inventory)
    .where(and(eq(inventory.id, id), eq(inventory.ownerId, ownerId)));
}

/** 计算库存总值 */
export async function getInventoryValue(db: DrizzleDb, ownerId: number): Promise<number> {
  const rows = await db.select({
    v: sql<number>`COALESCE(SUM(${inventory.quantity} * ${inventory.avgPrice}), 0)`,
  }).from(inventory)
    .where(eq(inventory.ownerId, ownerId));
  return Number(rows[0]?.v) || 0;
}
