"use strict";
const assert = require("node:assert/strict");
process.env.WORLD_TAX_ENABLED = "true"; // Previously activated staging configuration.
delete process.env.WORLD_TAX_SUSPENDED;
const Taxes = require("../server_world_taxes");
const forbidden = new Proxy({}, {get(){throw new Error("Suspended taxes must not touch accounting or gems");}});
(async()=>{
  assert.equal(Taxes.enabled,false);
  await Taxes.ensureSchema(forbidden);
  await Taxes.assertCanAcquire(forbidden,forbidden,"owner");
  await Taxes.beforeOwnerChange(forbidden,forbidden,"old","new","world");
  await Taxes.afterOwnerChange(forbidden,forbidden,"old","new");
  await Taxes.authorizeTrade(forbidden,forbidden,"world","old","new","request");
  assert.deepEqual(await Taxes.status(forbidden,"owner"),{enabled:false});
  await assert.rejects(Taxes.preparePayment(forbidden,forbidden,"player",[],{},"request"),/not active/);
  console.log("[world-tax-suspension] PASS: activated environments start, no accrual/restrictions/payments, history untouched");
})().catch(error=>{console.error(error);process.exit(1);});
