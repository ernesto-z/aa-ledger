/* 数据文件的读写：滚动备份 + 防止覆盖别人的写入。
   只依赖 fs/path，方便单独做单元测试。 */

const fs = require('node:fs');
const path = require('node:path');

const BACKUP_DIR_NAME = 'aa-ledger-backups';
const KEEP_BACKUPS = 20;

function stamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

function backupDirFor(file) {
  return path.join(path.dirname(file), BACKUP_DIR_NAME);
}

/* 备份文件名：aa-ledger-data-2026-10-01-16-49-00-01.json
   末尾两位序号是为了同一秒内连续保存也能各留一份，同时保证按名字排就是按时间排。 */
function backupPathFor(dir, base, date, n) {
  return path.join(dir, `${base}-${stamp(date)}-${String(n).padStart(2, '0')}.json`);
}

function listBackups(file) {
  const dir = backupDirFor(file);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const base = path.basename(file).replace(/\.json$/i, '');
  return names
    .filter((n) => n.startsWith(`${base}-`) && n.endsWith('.json'))
    .map((n) => {
      const full = path.join(dir, n);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        /* 刚被删掉：排在最后 */
      }
      return { name: n, file: full, mtimeMs };
    })
    // 按时间从新到旧。文件名里带了序号（同一秒连点保存），只按名字排会排错。
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

function readBackupText(file) {
  const [newest] = listBackups(file);
  if (!newest) return null;
  try {
    return fs.readFileSync(newest.file, 'utf8');
  } catch {
    return null;
  }
}

function pruneBackups(file, keep = KEEP_BACKUPS) {
  const all = listBackups(file);
  let removed = 0;
  for (const entry of all.slice(keep)) {
    try {
      fs.unlinkSync(entry.file);
      removed += 1;
    } catch {
      /* 删不掉就算了，不影响本次保存 */
    }
  }
  return removed;
}

/* 把磁盘上现有的内容存成一份备份；内容和最新那份备份相同则跳过，避免连点保存刷出一堆重复备份。 */
function pushBackup(file, text, date = new Date()) {
  if (text === null || text === undefined) return null;
  if (readBackupText(file) === text) return null;
  const dir = backupDirFor(file);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(file).replace(/\.json$/i, '');
  let n = 1;
  let target = backupPathFor(dir, base, date, n);
  while (fs.existsSync(target)) {
    n += 1;
    target = backupPathFor(dir, base, date, n);
  }
  fs.writeFileSync(target, text, 'utf8');
  return target;
}

/* 读数据文件。text 为 '' 表示文件还不存在；损坏时把坏文件另存并报告位置。 */
function readDataFile(file) {
  if (!fs.existsSync(file)) return { data: null, text: '', corrupt: null };
  const text = fs.readFileSync(file, 'utf8');
  try {
    return { data: JSON.parse(text), text, corrupt: null };
  } catch {
    const broken = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, broken);
    return { data: null, text: '', corrupt: broken };
  }
}

/* 写数据文件。
   expected：调用方认为磁盘上现在应该是的内容（'' 表示「我读的时候没有文件」）。
   磁盘内容和 expected 不一致，说明有另一个实例写过，就不覆盖，改成另存一份 .conflict。 */
function writeDataFile(file, data, options = {}) {
  const { expected = null, keep = KEEP_BACKUPS } = options;
  const nextText = JSON.stringify(data, null, 2);
  const diskText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  if (expected !== null && diskText !== expected) {
    const conflict = `${file}.conflict-${stamp()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(conflict, nextText, 'utf8');
    return { written: false, unchanged: false, conflict, backup: null, text: diskText };
  }

  if (diskText === nextText) return { written: false, unchanged: true, conflict: null, backup: null, text: nextText };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = pushBackup(file, diskText || null);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, nextText, 'utf8');
  if (diskText) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
  pruneBackups(file, keep);
  return { written: true, unchanged: false, conflict: null, backup, text: nextText };
}

module.exports = {
  BACKUP_DIR_NAME,
  KEEP_BACKUPS,
  backupDirFor,
  listBackups,
  pushBackup,
  pruneBackups,
  readDataFile,
  writeDataFile,
};
