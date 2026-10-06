// Build the readable guide from the same report used by farming checks.
const fs = require('node:fs');
const path = require('node:path');
const client = path.resolve(__dirname, '../../pixel-mania');
const report = JSON.parse(fs.readFileSync(path.join(client, 'docs/farming-balance-report.json'), 'utf8'));
const data = JSON.stringify(report.rows).replaceAll('<', '\\u003c');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PixelMania farming guide</title>
<style>
:root{font-family:Arial,sans-serif;color:#30213e;background:#faf8fc;font-size:16px}*{box-sizing:border-box}body{margin:0}main{max-width:1450px;margin:auto;padding:30px 24px}h1{font-size:30px;margin:0 0 8px}p{line-height:1.6;margin:8px 0}.intro{max-width:1000px;color:#554961}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0 14px}label{display:grid;gap:6px;font-weight:600}input,select{font:inherit;border:1px solid #b7a6ca;border-radius:6px;background:white;padding:12px;min-height:44px}input{width:min(340px,80vw)}.count{font-size:14px;color:#61516e;margin-bottom:10px}.scroll{overflow:auto;border:1px solid #dfd5e8;border-radius:8px;background:white}table{border-collapse:collapse;width:100%;min-width:1090px;text-align:left}th{background:#62438c;color:white;font-weight:600;padding:15px 12px;line-height:1.4;position:sticky;top:0}td{padding:15px 12px;border-bottom:1px solid #ebe5f0;line-height:1.45;vertical-align:top}tbody tr:nth-child(4n+1){background:#f6f1fb}.name{min-width:220px}.sub{display:block;font-size:13px;color:#675773;margin-top:4px}.num{font-variant-numeric:tabular-nums}.gem{background:#fff8df}button{font:inherit;background:none;border:0;padding:0;text-align:left;color:#53367e;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px;min-height:32px}button:focus-visible{outline:2px solid #53367e;outline-offset:4px}.details td{background:#eee7f5;padding:16px 24px;line-height:1.7}.details p{max-width:1100px;overflow-wrap:anywhere}.details[hidden]{display:none}footer{margin-top:20px;font-size:14px;color:#61516e}a{color:#53367e}@media(max-width:600px){main{padding:20px 12px}h1{font-size:25px}.controls{gap:10px}label{font-size:14px}input{width:100%}.controls label:first-child{width:100%}}
</style></head><body><main>
<h1>PixelMania farming guide</h1>
<p class="intro">All 332 blocks and placed states. Read each reward as <strong>chance → amount</strong>. For example, <strong>30% → 1–3 blocks</strong> means a 30% chance to receive 1, 2, or 3 blocks, otherwise none.</p>
<p class="intro">A complete farming cycle returns <strong>1.05–1.10 seeds on average</strong> after harvesting and repeatedly breaking all returned blocks. Keep one seed to replant. Individual trees can return fewer seeds.</p>
<div class="controls"><label>Find a block<input id="search" type="search" placeholder="Dirt, obsidian, gold…"></label><label>Tier<select id="tier"><option value="">All tiers</option>${Array.from({length:14},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label><label>Show<select id="kind"><option value="">All entries</option><option value="farmable">Growable blocks</option><option value="other">Other blocks and placed states</option></select></label></div>
<div id="count" class="count" aria-live="polite"></div>
<div class="scroll"><table><thead><tr><th>Block</th><th>Ready to<br>harvest in</th><th>Break:<br>blocks</th><th>Break:<br>seeds</th><th>Gems per<br>100 breaks</th><th>Harvest:<br>blocks</th><th>Harvest:<br>seeds</th><th>Harvest:<br>average gems</th></tr></thead><tbody id="rows"></tbody></table></div>
<footer><p>Gem amounts are long-run averages, not guaranteed totals. Times start when a seed is planted. Existing trees keep their saved timers. Click a block name for exact rolls, exceptions, and source notes.</p><p>Water has no plantable tree or bucket rewards. Recoverable utilities do not generate repeatable gems. Equipment bonuses, event tickets, machine production, and XP are excluded.</p></footer>
</main><script>
const data=${data};
const labels={farm:'Growable',reclaimable_tree:'Growable / recoverable',variant:'Placed state',special:'Special / no tree',return:'Recoverable',unbreakable:'Unbreakable',liquid:'Liquid'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=s=>s.replaceAll('_',' ').replace(/\\b\\w/g,c=>c.toUpperCase());
const number=n=>Number(n.toFixed(3)).toLocaleString('en-US');
function duration(n){if(!n)return 'No tree';const parts=[];for(const [unit,size]of [['d',86400],['h',3600],['m',60],['s',1]]){const count=Math.floor(n/size);if(count)parts.push(count+unit);n%=size;}return parts.join(' ');}
function reward(m){if(!m.max)return 'None';if(m.min===1&&m.max===2&&m.chance===1)return 'Always 1 + '+number((m.mean-1)*100)+'% for 1 extra';const low=Math.max(1,m.min),amount=low===m.max?String(low):low+'–'+m.max;return (m.chance===1?'Always':number(m.chance*100)+'% →')+' '+amount;}
data.sort((a,b)=>(a.balance_tier||99)-(b.balance_tier||99)||a.id.localeCompare(b.id));
function render(){const search=document.getElementById('search').value.toLowerCase().trim(),tier=document.getElementById('tier').value,kind=document.getElementById('kind').value;
const selected=data.filter(r=>(!search||(r.name+' '+r.id).toLowerCase().includes(search))&&(!tier||r.balance_tier===Number(tier))&&(!kind||(kind==='farmable'?['farm','reclaimable_tree'].includes(r.mode):!['farm','reclaimable_tree'].includes(r.mode))));
document.getElementById('count').textContent=selected.length+' of '+data.length+' entries';
document.getElementById('rows').innerHTML=selected.map(r=>'<tr><td class="name"><button type="button" aria-expanded="false" aria-controls="detail-'+esc(r.id)+'">'+esc(title(r.name))+'</button><span class="sub">Tier '+(r.balance_tier||'—')+' · '+labels[r.mode]+'</span></td><td>'+duration(r.grow_seconds)+'</td><td>'+reward(r.break_blocks)+'</td><td>'+reward(r.break_seeds)+'</td><td class="num gem">'+number(r.break_gems.mean*100)+'</td><td>'+reward(r.tree_blocks)+'</td><td>'+reward(r.tree_seeds)+'</td><td class="num">'+(r.grow_seconds?number(r.tree_gems.mean):'—')+'</td></tr><tr class="details" id="detail-'+esc(r.id)+'" hidden><td colspan="8"><p><strong>On break:</strong> '+esc(r.break_details)+'</p><p><strong>On harvest:</strong> '+esc(r.tree_details)+'</p><p>'+esc(r.notes)+(r.seeds_per_cycle!==null?' Full cycle: '+number(r.seeds_per_cycle)+' seeds on average.':'')+'</p><p><strong>Sources:</strong> '+esc(r.source)+'. '+esc(r.growth_source||'No tree')+'.</p><p class="sub">Item ID: '+esc(r.id)+(r.seed_id?' · Seed: '+esc(r.seed_id):'')+'</p></td></tr>').join('');}
for(const id of ['search','tier','kind'])document.getElementById(id).addEventListener('input',render);
document.getElementById('rows').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const row=document.getElementById(button.getAttribute('aria-controls'));row.hidden=!row.hidden;button.setAttribute('aria-expanded',String(!row.hidden));});render();
</script></body></html>`;
const target=path.join(client,'docs/farming-guide.html');
if(process.argv.includes('--check')) require('node:assert/strict').equal(fs.readFileSync(target,'utf8'),html,'Regenerate the farming guide');
else fs.writeFileSync(target,html);
console.log(`Readable farming guide: ${report.rows.length} entries at ${target}`);
