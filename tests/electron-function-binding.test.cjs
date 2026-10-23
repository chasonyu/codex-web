const assert = require('node:assert/strict');
const test = require('node:test');
const { app } = require('../src/server/electron/index.js');
test('macOS Dock stub preserves Function binding semantics', () => {
  const dock = app.dock;
  const bound = dock.setIcon.bind(dock);
  assert.equal(typeof bound, 'function');
  assert.doesNotThrow(() => Reflect.apply(bound, dock, [null]));
  assert.doesNotThrow(() => dock.setIcon.call(dock, null));
  assert.doesNotThrow(() => dock.setIcon.apply(dock, [null]));
});
