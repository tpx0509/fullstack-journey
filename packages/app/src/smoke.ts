import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';

/**
 * 冒烟测试：真的起一个服务器、真的发 HTTP 请求。
 * 不用 curl、不用 Postman——fetch 就是 Node 自带的客户端。
 *
 * 每一项都对应一个 HTTP 知识点，跑通=知识点落地。
 */

interface Check {
  name: string;
  run: (base: string) => Promise<string>;
}

const json = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

/**
 * 413 必须用原始 http.request 测，不能用 fetch：
 * 服务端在读完请求体之前就回了响应，fetch 会把它当成传输错误，
 * 我们想看的是"服务端到底回了什么"，就必须直接读响应。
 */
function rawPost(
  base: string,
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<{ status: number; body: string }> {
  const port = Number(new URL(base).port);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: { 'content-type': contentType, 'content-length': body.length },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: text });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const checks: Check[] = [
  {
    name: 'GET /health → 200 + JSON',
    run: async (base) => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /application\/json; charset=utf-8/);
      const body = await json(res);
      assert.equal(body['ok'], true);
      return `status=${res.status} type=json`;
    },
  },
  {
    name: 'GET /users/42?x=1 → 路由参数 + 查询参数',
    run: async (base) => {
      const res = await fetch(`${base}/users/42?x=1&y=2`);
      assert.equal(res.status, 200);
      const body = await json(res);
      assert.equal(body['id'], '42');
      assert.deepEqual(body['query'], { x: '1', y: '2' });
      return `id=${String(body['id'])} query=${JSON.stringify(body['query'])}`;
    },
  },
  {
    name: 'GET /users/%E4%BD%A0%E5%A5%BD → 参数 URL 解码',
    run: async (base) => {
      const res = await fetch(`${base}/users/%E4%BD%A0%E5%A5%BD`);
      const body = await json(res);
      assert.equal(body['id'], '你好');
      return `id=${String(body['id'])}`;
    },
  },
  {
    name: 'GET /users/1/posts/2 → 多段参数按顺序捕获',
    run: async (base) => {
      const res = await fetch(`${base}/users/1/posts/2`);
      const body = await json(res);
      assert.equal(body['userId'], '1');
      assert.equal(body['postId'], '2');
      return `userId=1 postId=2`;
    },
  },
  {
    name: 'POST /echo (JSON) → body 解析',
    run: async (base) => {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1, list: [1, 2] }),
      });
      assert.equal(res.status, 200);
      const body = await json(res);
      assert.deepEqual(body['body'], { a: 1, list: [1, 2] });
      return `body=${JSON.stringify(body['body'])}`;
    },
  },
  {
    name: 'POST /echo (urlencoded) → 表单解析',
    run: async (base) => {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=%E5%BC%A0%E4%B8%89&age=30',
      });
      const body = await json(res);
      assert.deepEqual(body['body'], { name: '张三', age: '30' });
      return `body=${JSON.stringify(body['body'])}`;
    },
  },
  {
    name: 'POST /echo (坏 JSON) → 400 而不是 500',
    run: async (base) => {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":',
      });
      assert.equal(res.status, 400);
      const body = await json(res);
      const error = body['error'] as Record<string, unknown>;
      assert.equal(error['code'], 'INVALID_JSON');
      return `status=400 code=${String(error['code'])}`;
    },
  },
  {
    name: 'POST /echo (text/plain) → 415 不支持的媒体类型',
    run: async (base) => {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      });
      assert.equal(res.status, 415);
      return `status=415`;
    },
  },
  {
    name: 'POST /echo (2MB) → 413 超限拦截',
    run: async (base) => {
      const big = Buffer.from(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }));
      const res = await rawPost(base, '/echo', big, 'application/json');
      assert.equal(res.status, 413);
      const error = (JSON.parse(res.body) as { error: { code: string } }).error;
      assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
      return `status=413 code=${error.code}`;
    },
  },
  {
    name: 'POST /health → 405 + Allow 头',
    run: async (base) => {
      const res = await fetch(`${base}/health`, { method: 'POST' });
      assert.equal(res.status, 405);
      const allow = res.headers.get('allow') ?? '';
      assert.match(allow, /GET/);
      return `status=405 allow="${allow}"`;
    },
  },
  {
    name: 'GET /nope → 404',
    run: async (base) => {
      const res = await fetch(`${base}/nope`);
      assert.equal(res.status, 404);
      return `status=404`;
    },
  },
  {
    name: 'GET /boom → 500（进程不崩）',
    run: async (base) => {
      const res = await fetch(`${base}/boom`);
      assert.equal(res.status, 500);
      const body = await json(res);
      const error = body['error'] as Record<string, unknown>;
      assert.equal(error['code'], 'INTERNAL_ERROR');
      return `status=500`;
    },
  },
  {
    name: 'GET / → 302 + Location',
    run: async (base) => {
      const res = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/assets/');
      return `302 → ${res.headers.get('location') ?? ''}`;
    },
  },
  {
    name: 'GET /assets/hello.txt → 200 text/plain',
    run: async (base) => {
      const res = await fetch(`${base}/assets/hello.txt`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/plain; charset=utf-8/);
      const text = await res.text();
      assert.match(text, /手写静态文件服务/);
      return `200 ${res.headers.get('content-length')} bytes`;
    },
  },
  {
    name: 'GET /assets/ → 目录默认 index.html',
    run: async (base) => {
      const res = await fetch(`${base}/assets/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
      return `200 html`;
    },
  },
  {
    name: 'GET /assets（无尾斜杠）→ 301 到 /assets/',
    run: async (base) => {
      // redirect: 'manual' 才能看到 301 本身，否则 fetch 会自动跟随到 200
      const res = await fetch(`${base}/assets`, { redirect: 'manual' });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get('location'), '/assets/');
      return `301 → /assets/`;
    },
  },
  {
    name: 'GET /assets/%2e%2e%2fsecret.txt → 403 目录穿越被拦',
    run: async (base) => {
      const res = await fetch(`${base}/assets/%2e%2e%2fsecret.txt`);
      assert.equal(res.status, 403);
      return `status=403`;
    },
  },
  {
    name: 'HEAD /assets/hello.txt → 有头无体',
    run: async (base) => {
      const res = await fetch(`${base}/assets/hello.txt`, { method: 'HEAD' });
      assert.equal(res.status, 200);
      const length = Number(res.headers.get('content-length'));
      assert.ok(length > 0, 'Content-Length 应该大于 0');
      const text = await res.text();
      assert.equal(text, '');
      return `Content-Length=${length} body=0`;
    },
  },
  {
    name: 'GET /assets/hello.txt (If-None-Match) → 304',
    run: async (base) => {
      const first = await fetch(`${base}/assets/hello.txt`);
      const etag = first.headers.get('etag');
      assert.ok(etag, '响应必须带 ETag');
      await first.text();
      const second = await fetch(`${base}/assets/hello.txt`, {
        headers: { 'if-none-match': etag },
      });
      assert.equal(second.status, 304);
      const body = await second.text();
      assert.equal(body, '');
      return `304 etag=${etag}`;
    },
  },
  {
    name: 'GET + Range: bytes=0-9 → 206 前 10 字节',
    run: async (base) => {
      const fullRes = await fetch(`${base}/assets/hello.txt`);
      const fullBuf = Buffer.from(await fullRes.arrayBuffer());
      assert.equal(fullRes.headers.get('accept-ranges'), 'bytes');

      const res = await fetch(`${base}/assets/hello.txt`, { headers: { range: 'bytes=0-9' } });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), `bytes 0-9/${fullBuf.length}`);
      // Content-Length 必须是"这一段"的长度，不是文件总长度
      assert.equal(res.headers.get('content-length'), '10');
      const part = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(part, fullBuf.subarray(0, 10));
      return `206 10/${fullBuf.length} bytes`;
    },
  },
  {
    name: 'GET + Range: bytes=-20 → 206 末尾 20 字节',
    run: async (base) => {
      const fullBuf = Buffer.from(
        await (await fetch(`${base}/assets/hello.txt`)).arrayBuffer(),
      );
      const res = await fetch(`${base}/assets/hello.txt`, { headers: { range: 'bytes=-20' } });
      assert.equal(res.status, 206);
      const start = fullBuf.length - 20;
      assert.equal(
        res.headers.get('content-range'),
        `bytes ${start}-${fullBuf.length - 1}/${fullBuf.length}`,
      );
      const part = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(part, fullBuf.subarray(start));
      return `206 尾部 20 bytes`;
    },
  },
  {
    name: 'GET + Range: bytes=100- → 206 从 100 到结尾',
    run: async (base) => {
      const fullBuf = Buffer.from(
        await (await fetch(`${base}/assets/hello.txt`)).arrayBuffer(),
      );
      const res = await fetch(`${base}/assets/hello.txt`, { headers: { range: 'bytes=100-' } });
      assert.equal(res.status, 206);
      const part = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(part, fullBuf.subarray(100));
      return `206 ${part.length} bytes`;
    },
  },
  {
    name: 'GET + Range 超出文件 → 416 + Content-Range: bytes */size',
    run: async (base) => {
      const fullBuf = Buffer.from(
        await (await fetch(`${base}/assets/hello.txt`)).arrayBuffer(),
      );
      const res = await fetch(`${base}/assets/hello.txt`, { headers: { range: 'bytes=999999-' } });
      assert.equal(res.status, 416);
      assert.equal(res.headers.get('content-range'), `bytes */${fullBuf.length}`);
      await res.arrayBuffer();
      return `416 bytes */${fullBuf.length}`;
    },
  },
  {
    name: 'GET + Range 语法错误/多段 → 忽略，回 200 整个文件',
    run: async (base) => {
      const fullBuf = Buffer.from(
        await (await fetch(`${base}/assets/hello.txt`)).arrayBuffer(),
      );
      for (const range of ['bytes=0-1,5-6', 'items=0-1', 'bytes=abc-def']) {
        const res = await fetch(`${base}/assets/hello.txt`, { headers: { range } });
        assert.equal(res.status, 200, `${range} 应该被忽略`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(buf.length, fullBuf.length);
      }
      return `3 种非法 Range 全部降级为 200`;
    },
  },
  {
    name: 'HEAD + Range → 206 有头无体，Content-Length 是段长',
    run: async (base) => {
      const res = await fetch(`${base}/assets/hello.txt`, {
        method: 'HEAD',
        headers: { range: 'bytes=0-9' },
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-length'), '10');
      assert.match(res.headers.get('content-range') ?? '', /^bytes 0-9\/\d+$/);
      assert.equal(await res.text(), '');
      return `206 head-only len=10`;
    },
  },
  {
    name: 'DELETE /users/1 → 204 无响应体',
    run: async (base) => {
      const res = await fetch(`${base}/users/1`, { method: 'DELETE' });
      assert.equal(res.status, 204);
      const text = await res.text();
      assert.equal(text, '');
      return `status=204 body=0`;
    },
  },
];

async function main(): Promise<void> {
  const { server } = createApp({ quiet: true });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  console.log(`测试服务器：${base}\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const check of checks) {
    try {
      const detail = await check.run(base);
      passed += 1;
      console.log(`  PASS  ${check.name.padEnd(52, ' ')} ${detail}`);
    } catch (error) {
      failures.push(check.name);
      console.log(`  FAIL  ${check.name.padEnd(52, ' ')} ${(error as Error).message}`);
    }
  }

  console.log(`\n${passed}/${checks.length} 通过`);

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
