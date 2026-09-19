"use strict";
const assert=require('node:assert/strict');
const {encodeMovementColumns,compactMovementBatch,createServerSocketDeliveryHelpers}=require('../server_socket_delivery_helpers');
const decode=p=>!p.player_rows?p:{...Object.fromEntries(Object.entries(p).filter(([k])=>!['player_fields','player_rows'].includes(k))),players:p.player_rows.map(row=>Object.fromEntries(p.player_fields.map((key,i)=>[key,row[i]])))};
const make=(offset=0)=>({type:'player_position_batch',world:'TEST',players:Array.from({length:5},(_,i)=>({
 type:'player_position',player_id:'p'+i,x:123.456789012345+i+offset,y:64,world:'TEST',movement_sequence:i+offset,
 equipment_slots:{hand:i===0?'pickaxe':'',hair:''},on_floor:false,chat_typing:false,optional:null,
 future_metadata:{complete:true}})),left:[]});
const initial=make(),before=JSON.stringify(initial);
assert.deepEqual(decode(encodeMovementColumns(initial)),initial);
assert.equal(JSON.stringify(initial),before,'Shared input cannot be mutated');
for(const invalid of [{...initial,players:initial.players.slice(0,1)},{...initial,players:[...initial.players,{player_id:'legacy'}]},
 {...initial,players:initial.players.map(p=>({...p,absent:undefined}))}]) assert.equal(encodeMovementColumns(invalid),invalid);
const stats=new Proxy({}, {get:(o,k)=>o[k]||0,set:(o,k,v)=>{o[k]=v;return true;}});
const helpers=createServerSocketDeliveryHelpers({websocketOpenState:1,maxPacketBytes:65536,maxBufferedAmount:1024*1024,
 movementMaxBufferedAmount:256,movementResumeBufferedAmount:64,movementRetryMs:60000,playerNetworkStats:stats,
 getRawLength:raw=>Buffer.byteLength(raw),normalizePacketTypeName:x=>String(x),recordPacketTypeSize:()=>{},warn:()=>{}});
const sent=[];const socket={readyState:1,bufferedAmount:0,send:raw=>sent.push(JSON.parse(raw))};
helpers.sendPlayerPositionBatch(socket,initial,64);assert(sent.at(-1).players,'Legacy receiver stays compatible');
socket.movementBatchColumns=true;
helpers.sendPlayerPositionBatch(socket,initial,64);assert(sent.at(-1).player_rows);
assert.deepEqual(decode(sent.at(-1)),compactMovementBatch(initial));
socket.bufferedAmount=500;
helpers.sendPlayerPositionBatch(socket,initial,64);
const next=make(50);next.players[0].equipment_slots.hand='';
helpers.sendPlayerPositionBatch(socket,next,64);
socket.bufferedAmount=0;helpers.flushPendingPlayerPositionBatch(socket);
assert.deepEqual(decode(sent.at(-1)).players,compactMovementBatch(next).players,'Latest full snapshot and unequip survive coalescing');
socket.bufferedAmount=500;helpers.sendPlayerPositionBatch(socket,initial,64);
const newWorld={...make(90),world:'OTHER'};helpers.sendPlayerPositionBatch(socket,newWorld,64);
socket.bufferedAmount=0;helpers.flushPendingPlayerPositionBatch(socket);
assert.equal(sent.at(-1).world,'OTHER');
assert.deepEqual(decode(sent.at(-1)).players,newWorld.players);
socket.bufferedAmount=500;helpers.sendPlayerPositionBatch(socket,initial,64);
helpers.clearPlayerPositionDeliveryState(socket);assert.equal(socket._movementDeliveryState,undefined);
console.log('MOVEMENT_COLUMNS_OK: exact numeric/full-state roundtrip, legacy/heterogeneous fallback, backpressure, unequip, world change, cleanup');
