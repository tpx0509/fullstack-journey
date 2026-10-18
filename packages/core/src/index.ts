/**
 * @fj/core —— 跨包共享的类型和纯函数。
 * 这一层不依赖任何业务，也不引用 node:http 之外的东西。
 */

/** 显式表达“可能失败”的返回值，比到处 throw 好追踪 */
export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * 人类可读的字节数：1536 → "1.5 KB"
 * 注意 `units[i] ?? 'B'` 这个兜底——打开 noUncheckedIndexedAccess 后，
 * 索引访问的结果一定是 T | undefined，不兜底就编不过。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`formatBytes 只接受非负有限数，收到 ${bytes}`);
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const unit = units[index] ?? 'B';
  const digits = index === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

/** 取第一个元素，返回 T | undefined 而不是 T —— 强制调用方处理空数组 */
export const first = <T>(items: readonly T[]): T | undefined => items[0];

/** 枚举穷尽检查：将来加了分支忘了处理，编译期就报错 */
export function assertNever(value: never): never {
  throw new Error(`未处理的分支: ${JSON.stringify(value)}`);
}
