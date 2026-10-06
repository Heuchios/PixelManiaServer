"use strict";
const fs=require("node:fs");
const {sha256}=require("../ops_player_audit");
const filename=process.argv[2];
if(!filename) throw new Error("Usage: node scripts/verify_ops_player_evidence.js exported-evidence.json");
const bundle=JSON.parse(fs.readFileSync(filename,"utf8"));
for(const key of ["profile","evidence"]){
  if(!bundle[key]) continue;
  const {audit,...payload}=bundle[key];
  if(!audit?.response_sha256 || sha256(payload)!==audit.response_sha256) throw new Error(`${key}: response digest mismatch`);
  console.log(`${key}: digest verified; database access receipt ${audit.access_id}; request ${payload.request_id}`);
}
console.log("Digest verifies the exported content; compare the receipt against the retained database access log to establish provenance.");
