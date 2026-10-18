/**
 * @fj/core —— 跨包共享的类型和纯函数。
 * 这一层不依赖任何业务，也不引用 node:http 之外的东西。
 */

/** 显式表达“可能失败”的返回值，比到处 throw 好追踪 */
export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** 取第一个元素，返回 T | undefined 而不是 T —— 强制调用方处理空数组 */
export const first = <T>(items: readonly T[]): T | undefined => items[0];

/** 枚举穷尽检查：将来加了分支忘了处理，编译期就报错 */
export function assertNever(value: never): never {
  throw new Error(`未处理的分支: ${JSON.stringify(value)}`);
}

/** 取第2个元素，返回 T | undefined 而不是 T —— 强制调用方处理空数组 */
export const second = <T>(items: readonly T[]): T | undefined => items[1];
