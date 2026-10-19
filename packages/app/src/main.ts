import { createApp, PUBLIC_DIR } from './app.ts';

const PORT = Number(process.env.PORT ?? 3000);

const { server, router } = createApp();

server.listen(PORT, () => {
  console.log(`mini server 已启动：http://localhost:${PORT}`);
  console.log(`静态目录：${PUBLIC_DIR}`);
  console.log('已注册路由：');
  for (const line of router.list()) {
    console.log(`  ${line}`);
  }
  console.log('\n试试：');
  console.log(`  curl -i http://localhost:${PORT}/health`);
  console.log(`  curl -i http://localhost:${PORT}/users/42?x=1`);
  console.log(`  curl -i -X POST http://localhost:${PORT}/echo -H "Content-Type: application/json" -d '{"a":1}'`);
  console.log(`  curl -i http://localhost:${PORT}/assets/hello.txt`);
});

// Ctrl+C 先停止接收新连接，等在途请求结束再退出
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n收到 ${signal}，正在关闭...`);
    server.close(() => {
      process.exit(0);
    });
  });
}
