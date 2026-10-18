import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'] },

  eslint.configs.recommended,

  // 只有 .ts 才走「类型感知」规则 —— 这类规则需要文件属于某个 tsconfig
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // projectService 自动匹配每个文件所属的 tsconfig，不用手写 project 数组
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 后端最阴的坑：async 里漏掉 await，promise 静默失败
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // 配置文件、脚本是纯 JS，不做类型检查，但要保留基础规则
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.nodeBuiltin },
  },

  // 必须放最后：关掉与 Prettier 冲突的格式类规则
  prettier,
);
