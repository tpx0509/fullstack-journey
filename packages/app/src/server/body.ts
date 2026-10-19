import type { IncomingMessage } from 'node:http';
import { HttpError } from './context.ts';
import type { Middleware } from './compose.ts';

/** 默认上限 1MB：没有上限的 body 解析器等于给攻击者一个内存炸弹 */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/**
 * 读取原始请求体。
 *
 * 这里是整套代码里最容易被写错的地方，三个细节：
 * 1. req 是 Readable 流，必须监听 data/end，不能"一次性获取"
 * 2. 超限后不能直接 pause/断连——那会让客户端收到 ECONNRESET 而不是 413。
 *    正确做法是：立刻 reject 让上层回 413，同时保持流在流动、把剩余数据丢掉（linger drain）
 * 3. 流被中途销毁会触发 error，必须 reject，否则 Promise 永远挂着、连接泄漏
 */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      // 关键：不 pause。data 监听器还在，后续数据会被丢弃而不是堆在 socket 缓冲区里，
      // 客户端才有机会读到那个 413 响应
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      // settled 之后进入排空阶段：不再累积，直接扔
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0; // 立刻释放已缓冲的内存
        fail(new HttpError(413, `请求体超过 ${Math.round(limit / 1024)}KB 上限`, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => fail(error));
  });
}

/** 只取 type 部分，忽略 charset 等参数：application/json; charset=utf-8 → application/json */
function parseContentType(header: string | undefined): { type: string; charset: string } {
  if (!header) return { type: '', charset: 'utf-8' };
  const [type = '', ...params] = header.split(';');
  const charsetParam = params.find((p) => p.trim().toLowerCase().startsWith('charset='));
  return {
    type: type.trim().toLowerCase(),
    charset: charsetParam ? charsetParam.split('=')[1]?.trim().toLowerCase() ?? 'utf-8' : 'utf-8',
  };
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SUPPORTED = new Set(['application/json', 'application/x-www-form-urlencoded']);

/**
 * body 解析中间件。
 * 只处理确实会带 body 的方法；GET/HEAD/OPTIONS 直接放行，不做无谓等待。
 */
export function bodyParser(options: { limit?: number } = {}): Middleware {
  const limit = options.limit ?? DEFAULT_BODY_LIMIT;

  return async (ctx, next) => {
    if (!BODY_METHODS.has(ctx.method)) {
      await next();
      return;
    }

    const { type, charset } = parseContentType(ctx.req.headers['content-type']);
    if (!type) {
      // 没声明 Content-Type 就不猜。静默当 JSON 解析是最常见的错误来源
      await next();
      return;
    }

    if (!SUPPORTED.has(type)) {
      throw new HttpError(415, `不支持的 Content-Type: ${type}`, 'UNSUPPORTED_MEDIA_TYPE');
    }

    const buffer = await readBody(ctx.req, limit);

    // Content-Length 是客户端"声明"的长度，和实际收到的字节数必须一致。
    // 不一致通常意味着连接被中断，或者有人手工构造了非法请求。
    const declared = ctx.req.headers['content-length'];
    if (declared !== undefined && Number(declared) !== buffer.length) {
      throw new HttpError(400, `声明 ${declared} 字节，实际收到 ${buffer.length} 字节`, 'LENGTH_MISMATCH');
    }

    if (buffer.length === 0) {
      await next();
      return;
    }

    const raw = buffer.toString(charset === 'utf-8' || charset === 'utf8' ? 'utf8' : 'utf8');

    if (type === 'application/json') {
      try {
        ctx.body = JSON.parse(raw);
      } catch {
        // 把 parse 错误转成 400，而不是让异常冒到 500
        throw new HttpError(400, '请求体不是合法的 JSON', 'INVALID_JSON');
      }
    } else {
      // URLSearchParams 自带解码和重复键处理，比手写 split('&') 靠谱
      ctx.body = Object.fromEntries(new URLSearchParams(raw));
    }

    await next();
  };
}
