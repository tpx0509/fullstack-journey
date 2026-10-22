import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './context.ts';
import type { Middleware } from './compose.ts';

/** 扩展名 → MIME。浏览器全靠这个头决定怎么渲染，写错就是下载而不是显示 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

export interface StaticOptions {
  /** 对外暴露的目录根（绝对路径） */
  root: string;
  /** URL 前缀，默认挂在根上 */
  prefix?: string;
  /** Cache-Control 的 max-age（秒）。0 表示不缓存，只做协商缓存 */
  maxAge?: number;
}

/**
 * 静态文件中间件。
 *
 * 三个必须做对的地方：
 * 1. 目录穿越防护：/assets/../../etc/passwd 这类请求必须挡掉
 * 2. 解码顺序：先 decodeURIComponent 再 path.resolve，顺序反了 %2e%2e%2f 就能绕过检查
 * 3. 用流发送而不是 readFile：大文件不占内存，还能边读边发
 */
export function serveStatic(options: StaticOptions): Middleware {
  const root = path.resolve(options.root);
  const prefix = options.prefix ?? '/';
  const maxAge = options.maxAge ?? 0;

  return async (ctx, next) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      await next();
      return;
    }

    // 不在前缀范围内，交给后面的中间件
    if (prefix !== '/' && ctx.path !== prefix && !ctx.path.startsWith(`${prefix}/`)) {
      await next();
      return;
    }

    // 解码必须在拼接之前。decodeURIComponent 遇到非法序列会抛，直接 400
    let decoded: string;
    try {
      decoded = decodeURIComponent(ctx.path);
    } catch {
      throw new HttpError(400, 'URL 编码非法', 'BAD_PATH_ENCODING');
    }

    // 三步各管一件事，顺序不能换：
    // ① 补前导 /：把 URL 路径统一成 "/xxx" 形态。但空串不能补——
    //    空串意味着请求正好命中前缀本身（/assets），必须留给下面的目录分支发 301。
    //    补成 "/" 会被 ② 变成 index.html，浏览器 base 停在 /assets，
    //    页面里的 ./app.css 就解析到 /app.css 了。
    // ② 结尾是 / 说明是目录，补 index.html。
    // ③ 剥掉前导 /：path.resolve 会把 "/xxx" 当盘符根绝对路径，root 直接被顶掉，
    //    目录穿越防护会因此 403 掉所有合法请求。
    let relative = prefix === '/' ? decoded : decoded.slice(prefix.length);
    if (relative !== '' && !relative.startsWith('/')) relative = `/${relative}`;
    if (relative.endsWith('/')) relative += 'index.html';
    relative = relative.replace(/^\/+/, '');
    console.log('relative',relative)
    const target = path.resolve(root, relative);

    // 关键防线：解析后的真实路径必须仍在 root 之内。
    // 用 root + path.sep 而不是直接 startsWith(root)，
    // 否则 /public-evil 能骗过 /public 的前缀检查。
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new HttpError(403, '禁止访问静态目录之外的文件', 'FORBIDDEN_PATH');
    }

    const info = await stat(target).catch(() => null);
    if (!info) {
      // 文件不存在 → 交给下游，最终由 404 中间件兜底
      await next();
      return;
    }

    // 目录但没带尾斜杠：301 到带斜杠的地址，否则相对链接会解析错
    if (info.isDirectory()) {
      if (!ctx.path.endsWith('/')) {
        ctx.redirect(301, `${ctx.path}/`);
        return;
      }
      await next();
      return;
    }

    // ETag 用 大小+修改时间 拼，够用且零成本（不强求内容哈希）
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    ctx.header('ETag', etag);
    ctx.header('Last-Modified', info.mtime.toUTCString());
    ctx.header('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-cache');

    // 协商缓存：内容没变就不发正文，只回 304。带宽省下来的就是响应速度
    if (ctx.req.headers['if-none-match'] === etag) {
      ctx.noContent(304);
      return;
    }

    ctx.header('Content-Type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
    ctx.header('Content-Length', info.size);
    ctx.res.statusCode = 200;

    if (ctx.method === 'HEAD') {
      ctx.markSent();
      ctx.res.end();
      return;
    }

    // 流式发送：内存恒定，首字节立即可达
    ctx.markSent();
    try {
      await pipeline(createReadStream(target), ctx.res);
    } catch (error) {
      // 客户端中途断开（下载被取消）会抛 ERR_STREAM_PREMATURE_CLOSE，
      // 这属于正常现象，响应头早就发出去了，也没有第二次机会补救
      if (!ctx.res.writableEnded) {
        throw error;
      }
    }
  };
}
