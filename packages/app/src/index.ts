import { first, formatBytes, type Result } from '@fj/core';

interface FileStat {
  path: string;
  size: number;
}

/** 返回值明确写 Result，调用方不判断 ok 就拿不到 data —— 这是 strict 带来的最大好处 */
function summarize(stats: readonly FileStat[]): Result<string> {
  const head = first(stats);
  if (!head) {
    return { ok: false, error: new Error('没有可统计的文件') };
  }

  const total = stats.reduce((sum, item) => sum + item.size, 0);
  return { ok: true, data: `${head.path} 等 ${stats.length} 个文件，共 ${formatBytes(total)}` };
}

const demoStats: readonly FileStat[] = [
  { path: 'big-100mb.bin', size: 100 * 1024 * 1024 },
  { path: 'out-sync.bin', size: 100 * 1024 * 1024 },
  { path: 'readFile.js', size: 1.4 * 1024 },
];

const result = summarize(demoStats);
if (result.ok) {
  console.log(result.data);
} else {
  console.error(result.error.message);
  process.exitCode = 1;
}

console.log(`单文件大小：${formatBytes(demoStats[0]?.size ?? 0)}`);
