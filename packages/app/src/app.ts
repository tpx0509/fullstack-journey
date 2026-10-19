import path from 'node:path';
import type http from 'node:http';
import { bodyParser } from './server/body.ts';
import { createServer } from './server/index.ts';
import { Router } from './server/router.ts';
import { serveStatic } from './server/static.ts';

/** src/app.ts 与 dist/app.js 的父级都是 packages/app */
const PUBLIC_DIR = path.resolve(import.meta.dirname, '../public');

/**
 * 组装应用：路由表 + 中间件顺序在这里定义一次，
 * main.ts 负责监听端口，smoke.ts 负责发真实请求验证。
 * 把"定义"和"运行"分开，测试才能在没有端口冲突的情况下跑起来。
 */
export function createApp(options: { quiet?: boolean } = {}): { server: http.Server; router: Router } {
  const router = new Router();

  router.get('/health', (ctx) => {
    ctx.json(200, {
      ok: true,
      uptime: Number(process.uptime().toFixed(2)),
      now: new Date().toISOString(),
    });
  });

  // :id 会出现在 ctx.params.id 里
  router.get('/users/:id', (ctx) => {
    ctx.json(200, {
      id: ctx.params.id,
      name: `用户 ${ctx.params.id}`,
      // 路由参数和查询参数是两回事：/users/1?a=2
      query: Object.fromEntries(ctx.query),
    });
  });

  // 多段参数：验证捕获组按顺序取到正确的值
  router.get('/users/:id/posts/:postId', (ctx) => {
    ctx.json(200, { userId: ctx.params.id, postId: ctx.params.postId });
  });

  // 回显请求体，用来观察 bodyParser 干了什么
  router.post('/echo', (ctx) => {
    ctx.json(200, {
      method: ctx.method,
      contentType: ctx.req.headers['content-type'] ?? null,
      // HTTP 头名大小写不敏感，Node 统一转小写
      userAgent: ctx.req.headers['user-agent'] ?? null,
      body: ctx.body ?? null,
    });
  });

  // PUT 复用同一套 body 解析，验证方法不止 POST
  router.put('/users/:id', (ctx) => {
    ctx.json(200, { updated: ctx.params.id, payload: ctx.body ?? null });
  });

  router.delete('/users/:id', (ctx) => {
    ctx.noContent(204);
  });

  // 故意抛异常，确认统一错误处理把它变成 500 而不会让进程崩掉
  router.get('/boom', () => {
    throw new Error('这是故意抛出的异常');
  });

  router.get('/', (ctx) => {
    ctx.redirect(302, '/assets/');
  });

  const server = createServer(router, {
    quiet: options.quiet ?? false,
    middlewares: [
      // 1MB 上限：超了直接 413，不陪着攻击者吃内存
      bodyParser({ limit: 1024 * 1024 }),
      // 静态资源挂在 /assets 下，避免和接口路径打架
      serveStatic({ root: PUBLIC_DIR, prefix: '/assets', maxAge: 0 }),
    ],
  });

  return { server, router };
}

export { PUBLIC_DIR };
