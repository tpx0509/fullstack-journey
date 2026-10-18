/**
 * workspace 包链接兜底。
 *
 * 背景：pnpm 建 node_modules 目录链接时用的是符号链接，在部分 Windows 环境
 * （无开发者模式 / 受限账户）会静默失败，留下一个空目录，导致
 * “Cannot find module '@fj/core'”。而 Node 的 'junction' 类型不需要这些权限。
 *
 * 所以每次 install 后跑一遍这个脚本，缺什么补什么。幂等，跑多少次都一样。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(root, 'packages');

/** 读取 workspace 里的所有包：名字 → 目录 */
function readWorkspace() {
  const map = new Map();
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgFile = path.join(packagesDir, dir, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (pkg.name) map.set(pkg.name, { dir: path.join(packagesDir, dir), pkg });
  }
  return map;
}

/** 在 baseDir/node_modules 下建立 pkgName → 真实目录 的链接 */
function link(baseDir, pkgName, target) {
  const linkPath = path.join(baseDir, 'node_modules', ...pkgName.split('/'));

  // 已经是有效链接就直接跳过（junction 的 realpath 会指向真实目录）
  try {
    if (fs.realpathSync(linkPath) === fs.realpathSync(target)) return 'skip';
  } catch {
    // 不存在或已损坏，继续往下建
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, 'junction');
  return 'linked';
}

const workspace = readWorkspace();
const results = [];

for (const [name, { dir, pkg }] of workspace) {
  // 1) 根目录也挂一份，方便根脚本和根配置解析
  results.push([`root → ${name}`, link(root, name, dir)]);

  // 2) 谁依赖它，就在谁的 node_modules 里挂
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const [depName, { dir: depDir }] of workspace) {
    if (depName === name) continue;
    if (!Object.keys(deps).includes(depName)) continue;
    results.push([`${name} → ${depName}`, link(dir, depName, depDir)]);
  }
}

for (const [label, action] of results) {
  console.log(`[link-workspace] ${label}: ${action}`);
}
