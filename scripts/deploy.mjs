// dist/ を gh-pages ブランチとして origin に push する（GitHub Pages の公開元）
// dist/ の中で一時的な git リポジトリを作って強制 push するので、gh-pages の履歴は毎回1コミットになる
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const origin = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim();
if (!existsSync('dist/index.html')) throw new Error('dist/ がありません。先に vite build してください');
rmSync('dist/.git', { recursive: true, force: true });
writeFileSync('dist/.nojekyll', '');
run('git', ['init', '-q', '-b', 'gh-pages'], 'dist');
run('git', ['add', '-A'], 'dist');
run('git', ['commit', '-q', '-m', `deploy ${new Date().toISOString()}`], 'dist');
run('git', ['push', '-f', origin, 'gh-pages'], 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('gh-pages に push しました');
