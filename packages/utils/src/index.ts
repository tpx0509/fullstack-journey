/**
 * @fj/utils —— 跨包共享的类型和纯函数。
 * 这一层不依赖任何业务，也不引用 node:http 之外的东西。
 */

/**
 * 人类可读的字节数：1536 → "1.5 KB"
 * 注意 `units[i] ?? 'B'` 这个兜底——打开 noUncheckedIndexedAccess 后，
 * 索引访问的结果一定是 T | undefined，不兜底就编不过。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`formatBytes 只接受非负有限数，收到 ${bytes}`);
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const unit = units[index] ?? 'B';
  const digits = index === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}
