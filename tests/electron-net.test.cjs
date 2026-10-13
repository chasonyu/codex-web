const assert = require('node:assert/strict');
const test = require('node:test');
const { net } = require('../src/server/electron/index.js');

test('desktop reconnect can query online status without crashing the web host', () => {
  let reconnectAllowed;
  assert.doesNotThrow(() => { reconnectAllowed = net.isOnline(); });
  assert.equal(typeof reconnectAllowed, 'boolean');
  assert.equal(reconnectAllowed, true);
});
