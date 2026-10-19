import type { Context } from './context.ts';

export type Next = () => Promise<void>;
export type Middleware = (ctx: Context, next: Next) => void | Promise<void>;

/**
 * 洋葱模型中间件组合器（Express/Koa 同款思路，实现只有 15 行）。
 *
 * 关键点：
 * - next() 之前的代码是"请求阶段"，之后的代码是"响应阶段"，可以包住所有下游
 * - 必须防止同一个中间件调用两次 next()，否则下游会执行两遍（经典 bug）
 * - 任何一个中间件 throw，都会被 dispatch 的 await 天然冒泡到 createServer 的 catch
 */
export function compose(middlewares: readonly Middleware[]): (ctx: Context) => Promise<void> {
  return async function run(ctx: Context): Promise<void> {
    let lastIndex = -1;

    const dispatch = async (index: number): Promise<void> => {
      // 索引必须递增：第二次 next() 会拿到相同的 index
      if (index <= lastIndex) {
        throw new Error('next() 被重复调用了，检查中间件里是否忘了 return');
      }
      lastIndex = index;

      const middleware = middlewares[index];
      // 链走完了，正常返回
      if (!middleware) return;

      await middleware(ctx, () => dispatch(index + 1));
    };

    await dispatch(0);
  };
}
