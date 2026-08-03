/**
 * drizzle/queries/users.queries.ts — 用户管理查询
 */
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { users } from '../schema/users';

/** 列出所有用户（不含密码哈希） */
export function listUsers(db: DrizzleDb) {
  return db.select({
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    role: users.role,
    companyName: users.companyName,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.id);
}

/** 检查用户名是否存在 */
export async function usernameExists(db: DrizzleDb, username: string): Promise<boolean> {
  const row = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return row.length > 0;
}

/** 创建用户 */
export function createUser(
  db: DrizzleDb,
  data: { username: string; passwordHash: string; displayName: string; companyName: string; role?: string }
) {
  return db.insert(users)
    .values({
      username: data.username,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      companyName: data.companyName,
      role: data.role || 'admin',
    })
    .returning({ id: users.id });
}

/** 更新用户信息 */
export function updateUser(
  db: DrizzleDb,
  id: number,
  data: { displayName?: string; companyName?: string }
) {
  if (data.displayName === undefined && data.companyName === undefined) return Promise.resolve();
  return db.update(users)
    .set({ displayName: data.displayName, companyName: data.companyName })
    .where(eq(users.id, id));
}

/** 重置用户密码 */
export function resetPassword(db: DrizzleDb, id: number, passwordHash: string) {
  return db.update(users)
    .set({ passwordHash })
    .where(eq(users.id, id));
}

/** 删除用户 */
export function deleteUser(db: DrizzleDb, id: number) {
  return db.delete(users)
    .where(eq(users.id, id));
}
