const assert = require('node:assert/strict');
const Store = require('../postgres_store');

(async () => {
  const store = new Store({enabled:false, schema:'pixelmania'});
  const ids = { USO:'00000000-0000-0000-0000-000000000001', UCE:'00000000-0000-0000-0000-000000000002' };
  store.ensurePlayerIdentity = async (_,name) => ids[String(name).toUpperCase()];
  store.lookupAccountIdByPlayerId = async (_,id) => 'account-'+id;
  let saved;
  const client = {query:async (sql,params) => {
    if(sql.includes('INSERT INTO "pixelmania"."world_locks"')) saved=JSON.parse(params[6]);
    return {rows:[],rowCount:1};
  }};
  for(const role of ['admin','builder','visitor','remove']) {
    const lock = {is_locked:true,owner_name:'USO',owner_player_id:ids.USO,owner_account_id:'account-'+ids.USO,
      allowed_players:role==='remove'?[]:['UCE'], player_roles:role==='remove'?{}:{UCE:role},
      allowed_account_ids:['account-'+ids.UCE],allowed_player_ids:[ids.UCE],
      player_roles_by_account_id:{['account-'+ids.UCE]:'admin'},player_roles_by_player_id:{[ids.UCE]:'admin'}};
    await store.mirrorWorldLockState(client,'test-world',{world_lock:lock});
    const expected=role==='remove'?undefined:role;
    assert.equal(saved.player_roles_by_account_id['account-'+ids.UCE],expected);
    assert.equal(saved.player_roles_by_player_id[ids.UCE],expected);
    if(role==='remove') {
      assert.deepEqual(saved.allowed_account_ids,[]);
      assert.deepEqual(saved.allowed_player_ids,[]);
    }
  }
  console.log('[world-lock-role-persistence] passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
