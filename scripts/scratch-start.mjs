/* 启动一个「只碰临时数据」的应用实例，用于测试和界面验证。
   数据文件与应用目录都指到系统临时目录下的 aa-ledger-test，
   所以怎么改、怎么存都不会动到 %APPDATA%\\aa-ledger 里你真正在记的那份账。

   用法：
     npm run start:test                     默认临时目录
     npm run start:test -- --seed           启动前塞一份示例数据（不存在时才写）
     AA_LEDGER_TEST_DIR=D:\\x npm run start:test
*/
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const root = process.cwd();
const dir = process.env.AA_LEDGER_TEST_DIR || path.join(os.tmpdir(), 'aa-ledger-test');
const userData = path.join(dir, 'userData');
const dataFile = path.join(dir, 'aa-ledger-data.json');
fs.mkdirSync(userData, { recursive: true });

if (process.argv.includes('--seed') && !fs.existsSync(dataFile)) {
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    dataFile,
    JSON.stringify(
      {
        version: 1,
        settings: { meId: 'm_me' },
        members: [
          { id: 'm_me', name: '测试我' },
          { id: 'm_b', name: '测试甲' },
          { id: 'm_c', name: '测试乙' },
        ],
        categories: ['餐饮', '交通', '住宿', '门票', '日用', '其他'],
        ledgers: [
          {
            id: 'l_t',
            name: '测试账本',
            currency: '¥',
            memberIds: ['m_me', 'm_b', 'm_c'],
            entries: [
              { id: 'e1', date: today, amountCents: 30000, payerId: 'm_me', category: '餐饮', note: '示例：午饭', createdAt: Date.now() },
              { id: 'e2', date: today, amountCents: 12000, payerId: 'm_b', category: '交通', note: '示例：打车', createdAt: Date.now() },
            ],
          },
        ],
        ui: { activeLedgerId: 'l_t', tab: 'flow' },
      },
      null,
      2,
    ),
    'utf8',
  );
}

const extraArgs = process.argv.slice(2).filter((a) => a !== '--seed');
console.log('[start:test] 数据文件 =', dataFile);
console.log('[start:test] 应用目录 =', userData);

const child = spawn(electronPath, ['.', ...extraArgs], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, AA_LEDGER_DATA: dataFile, AA_LEDGER_USER_DATA: userData },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
