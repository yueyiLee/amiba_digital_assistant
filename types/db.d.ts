/**
 * 数据库层类型声明
 */

import { Pool } from 'pg';

export interface DbStatus {
  ready: boolean;
  error: string | null;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
}

export interface DiagResult {
  mode: string;
  hasNativePgConfig: boolean;
  poolConnected: boolean;
}

export interface DbModule {
  pool: Pool;
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  queryOne: (text: string, params?: unknown[]) => Promise<Record<string, unknown> | null>;
  queryAll: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  insertReturning: (text: string, params?: unknown[]) => Promise<QueryResult>;
  init: () => Promise<void>;
  getStatus: () => DbStatus;
  getDiag: () => DiagResult;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  company_name: string;
  role: string;
  created_at?: string;
}
