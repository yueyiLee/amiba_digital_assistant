/**
 * @cloudbase/manager-node 自定义类型声明
 * 该包无官方 TypeScript 类型，此处提供最小类型桩
 */

declare module '@cloudbase/manager-node' {
  interface CloudBaseInitOptions {
    secretId?: string;
    secretKey?: string;
    token?: string;
    envId: string;
  }

  interface ExecutePGSqlParams {
    EnvId: string;
    Sql: string;
  }

  interface ExecutePGSqlResult {
    Columns?: string[];
    Rows?: string[];
  }

  interface DatabaseAPI {
    executePGSql(params: ExecutePGSqlParams): Promise<ExecutePGSqlResult>;
  }

  interface CloudBaseApp {
    database: DatabaseAPI;
  }

  export function init(options: CloudBaseInitOptions): CloudBaseApp;
}
