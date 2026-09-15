// Run the production permission helpers in isolation, without starting a server.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const names = new Set(['normalizeWorldLockAccessRole', 'canWorldLockRoleBuild',
  'canWorldLockRoleToggleWoodenEntrance', 'getWorldLockRoleForAccount',
  'canPlayerBuildInWorld', 'canPlayerToggleWoodenEntrance', 'canPlayerPassWoodenEntrance']);
const selected = [...names].map(name => {
  const match = source.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
  assert.ok(match, 'Missing production helper: ' + name);
  return match[0];
});
assert.equal(selected.length, names.size);
const context = { WORLD_LOCK_ACCESS_ROLES: new Set(['admin', 'builder', 'visitor']),
  accountKey: s => String(s || '').trim().toLowerCase(),
  isAdmin: () => false, ensureWorldState: () => ({}),
  lock: {is_locked: true, public_build: false},
  lockOwnerMatchesPlayer: (_, p) => p.owner === true,
  getWorldLockRoleForPlayer: (_, p) => p.role || '' };
context.getEffectiveWorldLockStateInState = () => context.lock;
vm.createContext(context);
vm.runInContext(selected.join('\n'), context);
for (const role of ['admin', 'builder', 'visitor', '']) {
  const player = {authenticated: true, account_username: 'test', role};
  assert.equal(context.canPlayerBuildInWorld(player, 'TEST'), ['admin', 'builder'].includes(role));
  assert.equal(context.canPlayerToggleWoodenEntrance(player, 'TEST'), role === 'admin');
  assert.equal(context.canPlayerPassWoodenEntrance(player, 'TEST'), role !== '');
}
context.lock.public_build = true;
assert.equal(context.canPlayerBuildInWorld({authenticated: true, account_username: 'test', role: 'visitor'}, 'TEST'), true);
assert.equal(context.canPlayerBuildInWorld({authenticated: false}, 'TEST'), false);
const lock = {allowed_players: ['TEST'], player_roles: {TEST: 'visitor'}};
assert.equal(context.getWorldLockRoleForAccount(lock, 'test'), 'visitor');
lock.player_roles.TEST = 'builder';
assert.equal(context.getWorldLockRoleForAccount(lock, 'test'), 'builder');
lock.player_roles.TEST = 'admin';
assert.equal(context.getWorldLockRoleForAccount(lock, 'test'), 'admin');
assert.equal(context.normalizeWorldLockAccessRole(' ADMIN '), 'admin');
assert.equal(context.canWorldLockRoleBuild('invalid'), false);
assert.equal(context.normalizeWorldLockAccessRole('member'), 'visitor');
assert.equal(context.canWorldLockRoleBuild('member'), false);
console.log('[world-lock-roles] passed');
