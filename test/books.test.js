// shellbook v0.2 — parser 單元測試（不需起 server）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBlocks, parseInfo, chapterTitle } = require('../src/books');

test('parseInfo：#run / #step / cwd / expect', () => {
  assert.deepEqual(parseInfo('sh #run'), { lang: 'sh', mode: 'run', cwd: null, expect: null });
  assert.deepEqual(parseInfo('bash #step'), { lang: 'bash', mode: 'step', cwd: null, expect: null });
  assert.deepEqual(parseInfo('bash #step cwd:workspace/demo expect:hello'), {
    lang: 'bash',
    mode: 'step',
    cwd: 'workspace/demo',
    expect: 'hello',
  });
  // 同時出現以 #step 為準
  assert.equal(parseInfo('sh #run #step').mode, 'step');
  assert.equal(parseInfo('sh').mode, null);
});

test('parseBlocks：有標籤才收，無標籤略過', () => {
  const md = '# T\n\n```sh #run\necho hi\n```\n\n```sh\necho plain\n```\n';
  const blocks = parseBlocks(md, 'ch1');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].id, 'ch1-1');
  assert.equal(blocks[0].code, 'echo hi');
  assert.equal(blocks[0].mode, 'run');
});

test('parseBlocks：空 block 略過，序號連續', () => {
  const md = '```sh #run\n   \n```\n\n```bash #step\na\n```\n\n```bash #run\nb\n```\n';
  const blocks = parseBlocks(md, 'ch2');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].id, 'ch2-1');
  assert.equal(blocks[1].id, 'ch2-2');
});

test('parseBlocks：多行 code 保留換行、去尾空白', () => {
  const md = '```bash #step\npwd\nls  \n\n```\n';
  const blocks = parseBlocks(md, 'ch3');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].code, 'pwd\nls');
});

test('parseBlocks：未閉合 fence 不炸（寬容處理）', () => {
  const md = '```sh #run\necho oops\n';
  const blocks = parseBlocks(md, 'ch4');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].code, 'echo oops');
});

test('parseBlocks：cwd/expect 進 block', () => {
  const md = '```bash #step cwd:workspace/demo expect:apple\ngrep apple f\n```\n';
  const blocks = parseBlocks(md, 'ch5');
  assert.equal(blocks[0].cwd, 'workspace/demo');
  assert.equal(blocks[0].expect, 'apple');
});

test('chapterTitle：取第一個 H1，無則 fallback', () => {
  assert.equal(chapterTitle('# 第一章\n\nxxx\n', 'f'), '第一章');
  assert.equal(chapterTitle('no heading\n', 'myfile'), 'myfile');
});
