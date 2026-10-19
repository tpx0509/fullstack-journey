import http from 'node:http';
import { compose, type Middleware } from './compose.ts';
import { Context, HttpError } from './context.ts';
import type { Router } from './router.ts';

export interface ServerOptions {
  /** 路由之前的中间件，按数组顺序执行（洋葱模型） */
  middlewares?: Middleware[];
  /** 关掉访问日志 */
  quiet?: boolean;
}

/** 访问日志：把方法、路径、状态码、耗时打出来，出问题第一眼就看这个 */
function accessLogger(quiet: boolean): Middleware {
  return async (ctx, next) => {
    const startedAt = process.hrtime.bigint();
    try {
      await next();
    } finally {
      if (!quiet) {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const status = ctx.isSent ? ctx.res.statusCode : 499;
        console.log(`${ctx.method} ${ctx.path} ${status} ${ms.toFixed(1)}ms`);
      }
    }
  };
}

/** 兜底 404：走到链尾说明谁都没处理这个请求 */
const notFound: Middleware = () => {
  throw new HttpError(404, '接口不存在', 'NOT_FOUND');
};

/**
 * 把中间件和路由组装成一个 http.Server。
 *
 * 顺序就是语义，不能随便调：
 *   日志 → body 解析 → 静态文件 → 路由 → 404 兜底
 * 静态在路由前面，路由没命中才有机会落到静态；
 * 404 必须在最后，否则前面任何"不处理"的请求都会挂住不返回。
 */
export function createServer(router: Router, options: ServerOptions = {}): http.Server {
  const chain = compose([
    accessLogger(options.quiet ?? false),
    ...(options.middlewares ?? []),
    router.middleware(),
    notFound,
  ]);

  const server = http.createServer((req, res) => {
    const ctx = new Context(req, res);
    // 用 void 明确表示"有意不等待"——业务错误全部由 handleError 消化，
    // 绝不能让 Promise 悬空，否则 ESLint 的 no-floating-promises 会拦下来
    void chain(ctx).catch((error: unknown) => {
      handleError(ctx, error);
    });
  });

  // Node 默认 requestTimeout 300s 太长：慢速攻击能靠这个占满连接
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  // 客户端在请求行阶段就断了（半包、非法报文），此时还没有 req/res 对象
  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });

  return server;
}

/** 统一错误出口：HttpError 用它自带的状态码，其它一律 500 */
function handleError(ctx: Context, error: unknown): void {
  if (ctx.isSent) {
    // 响应已经发出去一半了，唯一能做的是掐断连接，让客户端知道这次响应不完整
    ctx.res.destroy();
    return;
  }

  if (error instanceof HttpError) {
    // 注意：413 不要设 Connection: close。
    // 连接上还有没读完的请求体，立即关闭会让内核发 RST，
    // 客户端只能看到 ECONNRESET，根本读不到这个 413。
    // body 层已经保持流在流动、把剩余数据丢弃，等对端发完后连接自然收尾。
    ctx.json(error.status, { error: { code: error.code, message: error.message } });
    return;
  }

  console.error('[unhandled]', error);
  ctx.json(500, { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
}
