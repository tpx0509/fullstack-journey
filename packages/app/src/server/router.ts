import { HttpError, type Context } from './context.ts';

export type RouteHandler = (ctx: Context) => void | Promise<void>;

interface CompiledRoute {
  method: string;
  /** /users/:id → ^/users/([^/]+)/?$ */
  pattern: RegExp;
  /** 参数名顺序，和正则捕获组一一对应 */
  keys: readonly string[];
  raw: string;
  handler: RouteHandler;
}

/** 把路径里的正则元字符转义，否则 /a.b 会匹配 /axb */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 编译路由模板。
 * 只支持两种片段：静态字符串 和 :param。
 * 别小看这两样——NestJS 底下也是这套，通配符是额外的一层。
 */
export function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return escapeRegExp(segment);
    })
    .join('/');

  // 末尾斜杠可选：/users 和 /users/ 走同一个 handler
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    const { pattern, keys } = compilePath(path);
    this.routes.push({ method: method.toUpperCase(), pattern, keys, raw: path, handler });
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.add('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): this {
    return this.add('PUT', path, handler);
  }

  patch(path: string, handler: RouteHandler): this {
    return this.add('PATCH', path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.add('DELETE', path, handler);
  }

  /** 已注册的路径，仅用于调试输出 */
  list(): string[] {
    return this.routes.map((route) => `${route.method} ${route.raw}`);
  }

  /**
   * 匹配路由。
   * 三种结果：
   * - { handler } → 命中，执行
   * - { allow }   → 路径对但方法不对，应该回 405 并给 Allow 头
   * - null        → 完全没有这个路径，交给下一个中间件（比如静态文件）
   */
  match(ctx: Context): { handler: RouteHandler; params: Record<string, string> } | { allow: string[] } | null {
    let pathMatched = false;
    const allow = new Set<string>();

    // HEAD 复用 GET 的处理逻辑：语义上 HEAD 就是"只要 GET 的响应头"
    const method = ctx.method === 'HEAD' ? 'GET' : ctx.method;

    for (const route of this.routes) {
      const result = route.pattern.exec(ctx.path);
      if (!result) continue;

      pathMatched = true;
      allow.add(route.method);
      if (route.method !== method) continue;

      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => {
        const raw = result[i + 1];
        if (raw === undefined) return;
        // 解码放在这里：%E4%BD%A0 这类参数必须先还原成中文
        params[key] = decodeURIComponent(raw);
      });

      return { handler: route.handler, params };
    }
    if (pathMatched) {
      // 405 必须带 Allow 头（RFC 9110 §15.5.6），列出该资源支持的方法
      return { allow: [...allow, ...(allow.has('GET') ? ['HEAD'] : [])] };
    }
    return null;
  }

  /** 供 createServer 组装的最后一段中间件 */
  middleware(): (ctx: Context, next: () => Promise<void>) => Promise<void> {
    return async (ctx, next) => {
      const matched = this.match(ctx);

      if (matched && 'allow' in matched) {
        const allowHeader = matched.allow.join(', ');
        ctx.header('Allow', allowHeader);
        throw new HttpError(405, `${ctx.method} ${ctx.path} 不允许，可用方法：${allowHeader}`, 'METHOD_NOT_ALLOWED');
      }

      if (!matched) {
        // 不在这里回 404：后面可能还有静态文件中间件要试
        await next();
        return;
      }

      ctx.params = matched.params;
      await matched.handler(ctx);
    };
  }
}
