/**
 * drizzle/queries/auth.queries.ts — 认证相关查询
 */
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { users } from '../schema/users';

/** 根据用户名查找用户 */
export async function findUserByUsername(db: DrizzleDb, username: string) {
  const rows = await db.select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0] || null;
}

/** 根据 ID 查找用户 */
export async function findUserById(db: DrizzleDb, id: number) {
  const rows = await db.select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] || null;
}

/** 更新用户密码 */
export function updatePassword(db: DrizzleDb, id: number, passwordHash: string) {
  return db.update(users)
    .set({ passwordHash })
    .where(eq(users.id, id));
}
