import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * HTTP 错误：带状态码，由顶层错误处理器统一转成响应。
 * 用 throw 表达失败，而不是在每层 return { ok: false }——
 * 请求处理是一条链，错误天然是"打断链"的语义。
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code ?? `E${status}`;
  }
}

/**
 * 一次请求的全部上下文。
 *
 * 为什么不直接用 (req, res) 传递：
 * 中间件需要在彼此之间共享数据（解析出的 body、当前用户、耗时），
 * 挂在 req 上会污染 Node 原始对象且没有类型；单独一个 ctx 更好管。
 */
export class Context {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** 解析后的 URL。注意：WHATWG URL 会规范化 /a/../b，但不会解码 %2e%2e */
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;

  /** 路由参数，如 /users/:id → { id: '1' } */
  params: Record<string, string> = {};
  /** 解析后的请求体，由 bodyParser 中间件填充 */
  body: unknown = undefined;
  /** 中间件之间传值的通用容器 */
  state: Record<string, unknown> = {};

  private sent = false;

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req;
    this.res = res;

    // req.url 只有路径部分（/a/b?x=1），没有协议和主机。
    // new URL 必须给个 base，随便什么主机都行，我们只取 pathname 和 search。
    const host = req.headers.host ?? 'localhost';
    this.url = new URL(req.url ?? '/', `http://${host}`);
    this.path = this.url.pathname;
    this.query = this.url.searchParams;
    this.method = (req.method ?? 'GET').toUpperCase();
  }

  /** 响应是否已经写出。防止错误处理器在响应已发出后再写一次 */
  get isSent(): boolean {
    return this.sent || this.res.writableEnded;
  }

  set(key: string, value: unknown): void {
    this.state[key] = value;
  }

  get<T>(key: string): T | undefined {
    return this.state[key] as T | undefined;
  }

  header(name: string, value: string | number): this {
    this.res.setHeader(name, value);
    return this;
  }

  /**
   * 写 JSON。三件事必须做对：
   * 1. Content-Type 带 charset，中文才不会乱码
   * 2. Content-Length 用字节长度，不是字符串长度
   * 3. HEAD 请求要发头不发体（RFC 9110 要求）
   */
  json(status: number, data: unknown): void {
    const body = Buffer.from(JSON.stringify(data), 'utf8');
    this.res.statusCode = status;
    this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.res.setHeader('Content-Length', body.length);
    this.endWithBody(body);
  }

  text(status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
    const buf = Buffer.from(body, 'utf8');
    this.res.statusCode = status;
    this.res.setHeader('Content-Type', contentType);
    this.res.setHeader('Content-Length', buf.length);
    this.endWithBody(buf);
  }

  html(status: number, body: string): void {
    this.text(status, body, 'text/html; charset=utf-8');
  }

  noContent(status = 204): void {
    this.res.statusCode = status;
    this.res.removeHeader('Content-Type');
    this.sent = true;
    this.res.end();
  }

  redirect(status: 301 | 302 | 307 | 308, location: string): void {
    this.res.statusCode = status;
    this.res.setHeader('Location', location);
    this.res.setHeader('Content-Length', 0);
    this.sent = true;
    this.res.end();
  }

  /** 只发头（HEAD 或显式要求空体时用） */
  endWithBody(body: Buffer): void {
    this.sent = true;
    if (this.method === 'HEAD') {
      this.res.end();
      return;
    }
    this.res.end(body);
  }

  markSent(): void {
    this.sent = true;
  }
}
