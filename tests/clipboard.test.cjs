const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the upstream copy handler with its real error/callback flow.
const asset = fs.readFileSync(path.join(__dirname,
  '../scratch/asar/webview/assets/app-shared-8bd9d0399038.js'), 'utf8');
const start = asset.indexOf('async function ONi(');
const end = asset.indexOf('\nvar kNi;', start);
assert.ok(start >= 0 && end > start, 'upstream copy handler must be present');
const source = asset.slice(start, end).replaceAll('import.meta.url', '"test://clipboard"');

function setup(clipboard) {
  const warnings = [];
  let errors = 0;
  const window = { navigator: { clipboard }, document: {
    hasFocus: () => true, visibilityState: 'visible',
  } };
  const copy = vm.runInNewContext(`(${source})`, {
    window, Promise, Blob,
    zf: { warning: (...args) => warnings.push(args) },
    DNi: () => { errors++; return false; },
    // A desktop RPC must never be used to write the browser's clipboard.
    Wf: () => { throw new Error('desktop clipboard RPC invoked'); },
  });
  return { copy, window, warnings, errors: () => errors };
}

test('plain text is copied immediately without desktop RPC', async () => {
  const writes = [];
  const state = setup({ writeText: text => { writes.push(text); return Promise.resolve(); } });
  let acknowledged = false;
  const result = state.copy('中文\ncopy test', undefined, () => { acknowledged = true; });
  assert.deepEqual(writes, ['中文\ncopy test']);
  assert.equal(await result, true);
  assert.equal(acknowledged, true);
  assert.equal(state.errors(), 0);
});

test('asynchronously generated text uses the browser clipboard', async () => {
  const writes = [];
  const state = setup({ writeText: async text => { writes.push(text); } });
  assert.equal(await state.copy(Promise.resolve('generated text')), true);
  assert.deepEqual(writes, ['generated text']);
});

test('copy targets the document owning the clicked element', async () => {
  const state = setup({ writeText: () => { throw new Error('wrong window'); } });
  const writes = [];
  const targetWindow = { ...state.window, navigator: { clipboard: {
    writeText: async text => { writes.push(text); },
  } } };
  assert.equal(await state.copy('target', { target: { ownerDocument: { defaultView: targetWindow } } }), true);
  assert.deepEqual(writes, ['target']);
});

test('permission rejection is reported as failure', async () => {
  const state = setup({ writeText: async () => { throw new Error('permission denied'); } });
  assert.equal(await state.copy('text'), false);
  assert.equal(state.errors(), 1);
  assert.equal(state.warnings[0][1].sensitive.error.message, 'permission denied');
});

test('unavailable clipboard fails without an uncaught exception', async () => {
  const state = setup(undefined);
  assert.equal(await state.copy('text'), false);
  assert.equal(state.errors(), 1);
});

test('rejected text generation is handled', async () => {
  const state = setup({ writeText: () => { throw new Error('must not write'); } });
  assert.equal(await state.copy(Promise.reject(new Error('generation failed'))), false);
  assert.equal(state.errors(), 1);
});

test('rich content plain-text fallback still copies', async () => {
  const writes = [];
  const state = setup({ writeText: async text => { writes.push(text); } });
  assert.equal(await state.copy({ 'text/plain': 'fallback', 'text/html': '<b>fallback</b>' }), true);
  assert.deepEqual(writes, ['fallback']);
});
