// shellbook v0.5 — guard.isDenied 單元測試（不需起 server）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDenied } = require('../src/guard');

const denied = [
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ///',
  'sudo rm -rf /',
  'FOO=1 rm -rf /',
  'rm -rf ~',
  'rm -rf $HOME',
  'rm -rf /etc',
  'rm -rf "/usr"',
  "rm -rf '/etc/hosts' x",
  'rm --no-preserve-root -rf /tmp/x',
  'echo hi && rm -rf /',
  'echo hi; rm -rf ~',
  'echo ok || mkfs.ext4 /dev/sda1',
  'echo $(rm -rf /)',
  'echo `rm -rf /`',
  'mkfs',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
  'shutdown -h now',
  'sudo reboot',
  'poweroff',
  ':(){ :|:& };:',
  'chmod -R 777 /',
  'chown -R root /',
  'echo hi > /dev/sda',
  'cat f > /dev/mem',
];

for (const line of denied) {
  test(`擋：${line}`, () => {
    const r = isDenied(line);
    assert.equal(r.denied, true, `should deny: ${line}`);
    assert.ok(r.reason, 'reason required');
  });
}

const allowed = [
  'echo hello',
  'git status',
  'rm -rf demo-play',
  'rm -rf "$P/upstream.git"',
  'rm -rf ./build out-1',
  'rm file.txt',
  'rm -rf /tmp/sb-probe-xyz',
  'mkdir -p x && ls',
  'docker build -t a .',
  'cargo test --offline',
  'echo "rm -rf /"',
  "echo 'shutdown now'",
  'cat f > /dev/null',
  'docker info >/dev/null 2>&1 && echo OK',
  'grep -q x f && echo ok',
  'TERM=dumb gh --version',
  'chmod +x run.sh',
  'printf "x" > out.txt',
  'dd if=/dev/zero of=./test.img bs=1k count=1',
  '# rm -rf / 只是註解',
  '',
  '   ',
];

for (const line of allowed) {
  test(`放：${line || '(空行)'}`, () => {
    const r = isDenied(line);
    assert.equal(r.denied, false, `should allow: ${line}`);
  });
}
