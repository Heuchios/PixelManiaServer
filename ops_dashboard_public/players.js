"use strict";
(() => {
  const $ = id => document.getElementById(`players${id}`);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const when = v => v ? new Date(v).toLocaleString() : "—";
  const size=50;
  let account=null,profile=null,evidence=null,offset=0,page=0,mode="player",instance="",timer,listing=0,details=0,generation=0,loaded=false,busy=false;
  let section="flags";
  const message = text => { $("Message").textContent=text; };
  const url = (path,params={}) => `${path}?${new URLSearchParams(params)}`;
  async function load(force=false) {
    if (!document.body.classList.contains("unlocked") || (loaded && !force)) return;
    loaded=true;
    await list();
  }
  async function list() {
    const seq=++listing, gen=generation;
    try {
      const data=await apiFetch(url("/api/players",{q:$("Search").value,offset,limit:size}));
      if(seq!==listing || gen!==generation) return;
      $("Count").textContent=`${data.total} accounts · ${offset+1}–${offset+data.rows.length}`;
      $("List").innerHTML=data.rows.length ? data.rows.map(p=>`<button class="player-choice${account===p.account_id?" selected":""}" data-account="${esc(p.account_id)}" type="button"><strong>${esc(p.username)}</strong><small>${esc(p.role)} · ${p.is_active?"enabled":"disabled"} · level ${esc(p.player_level)}</small><small>${esc(p.active_punishments)} active punishments · ${esc(p.recorded_security_flags)} security signals</small></button>`).join("") : '<p class="muted">No matching accounts.</p>';
      $("Previous").disabled=offset===0; $("Next").disabled=!data.has_more;
      message("");
    } catch(e) { if(seq===listing && gen===generation) { loaded=false; message(e.message); } }
  }
  async function select(id) {
    account=id; profile=null; evidence=null; mode="player"; section="flags"; page=0; $("Section").value=section;
    clearFilters();
    const seq=++details,gen=generation;
    $("Profile").textContent="Loading committed account state…"; $("History").classList.add("hidden");
    document.querySelectorAll("[data-account]").forEach(el=>el.classList.toggle("selected",el.dataset.account===id));
    try {
      const data=await apiFetch(`/api/players/${encodeURIComponent(id)}`);
      if(seq!==details || gen!==generation || id!==account) return;
      profile=data; renderProfile(data); $("History").classList.remove("hidden"); await history();
    } catch(e) { if(seq===details && gen===generation) message(e.message); }
  }
  function renderProfile(data) {
    const p=data.profile;
    const facts=[["Role",p.role],["Level",p.player_level],["Gems",p.gems],["Last saved world",p.current_world_name],["Last login",when(p.last_login_at)],["Inventory hash",data.coverage.inventory_hash]];
    $("Profile").innerHTML=`<h3>${esc(p.username)}</h3><p class="player-coverage">Account ${esc(p.account_id)}<br>Player ${esc(p.player_id)} · saved ${esc(when(p.saved_at))}<br>Captured ${esc(when(data.captured_at))} · receipt #${esc(data.audit.access_id)}</p>
      <div class="player-facts">${facts.map(([label,value])=>`<div class="player-fact"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("")}</div>
      ${data.flags.length?data.flags.map(f=>`<div class="player-flag"><strong>${esc(f.type.replaceAll("_"," "))}${f.item_type?` · ${esc(f.item_type)}`:""}</strong><p>${esc(f.explanation)}</p>${f.inventory_amount!==undefined?`Inventory: ${esc(f.inventory_amount)}${f.active_instances!==undefined?` · active instances: ${esc(f.active_instances)}`:` · ledger after: ${esc(f.ledger_after)}`}`:""}<details><summary>Flag evidence</summary><pre>${esc(JSON.stringify(f,null,2))}</pre></details></div>`).join(""):'<p class="status-ok">No inconsistency found in this inventory snapshot.</p>'}
      <p class="player-coverage">${esc(data.coverage.note)}<br>First retained item transaction: ${esc(when(data.coverage.first_item_transaction))} · ${esc(data.coverage.ledger_rows || 0)} ledger records</p>
      <details open><summary>Inventory · ${data.inventory.length} item types</summary><div class="player-scroll"><table class="player-table"><thead><tr><th>Item / category</th><th>Quantity</th><th>Active instances</th><th>Trace</th></tr></thead><tbody>${data.inventory.map(i=>`<tr><td>${esc(i.name)}<br><span class="muted">${esc(i.item_category)}</span></td><td>${esc(i.amount)} ${esc(i.unit)}</td><td>${i.tracked?esc(i.instances):"not tracked"}</td><td><button class="player-link" data-item="${esc(i.item_type)}" type="button">Ledger</button>${i.tracked?` · <button class="player-link" data-item-instances="${esc(i.item_type)}" type="button">Instances</button>`:""}</td></tr>`).join("") || '<tr><td colspan="4">No persisted inventory.</td></tr>'}</tbody></table></div></details>`;
  }
  function clearFilters() { for(const k of ["ItemFilter","RefFilter","Since","Until"]) $(k).value=""; }
  function filterParams() {
    const result={offset:page*size,limit:size};
    if(page>0 && evidence?.ceiling) result.ceiling=evidence.ceiling;
    if(mode!=="player") return result;
    const supportsItems=["ledger","items","instances"].includes(section);
    const supportsRefs=["ledger","items","instances","security"].includes(section);
    if(supportsItems) result.item=$("ItemFilter").value.trim();
    if(supportsRefs) result.ref=$("RefFilter").value.trim();
    if($("Since").value) result.since=new Date($("Since").value).toISOString();
    if($("Until").value) result.until=new Date($("Until").value).toISOString();
    return result;
  }
  async function history() {
    if(mode==="player" && !account) return;
    const seq=++details,gen=generation;
    busy=true; $("Export").disabled=true; $("EvidencePrevious").disabled=true; $("EvidenceNext").disabled=true;
    $("History").classList.remove("hidden"); $("Evidence").textContent="Loading evidence…";
    $("Filters").classList.toggle("hidden",mode!=="player" || section==="worlds");
    $("ItemFilter").disabled=!["ledger","items","instances"].includes(section);
    $("RefFilter").disabled=!["ledger","items","instances","security"].includes(section);
    $("Section").disabled=!account;
    $("InstanceViews").classList.toggle("hidden",!mode.startsWith("instance"));
    const path=mode==="access"?"/api/players/access-audit":mode.startsWith("instance")?`/api/players/instances/${encodeURIComponent(instance)}${mode==="instance-ledger"?"/ledger":""}`:`/api/players/${encodeURIComponent(account)}/${section}`;
    try {
      const data=await apiFetch(url(path,filterParams()));
      if(seq!==details || gen!==generation) return;
      evidence=data;
      $("EvidenceTitle").textContent=mode.startsWith("instance")?`Item ${instance} · owner ${data.instance.owner_username || "none"} · ${data.instance.current_location} · ${data.instance.state}`:mode==="access"?"Dashboard access audit":$("Section").selectedOptions[0].textContent;
      $("EvidenceCoverage").textContent=data.coverage;
      $("Evidence").innerHTML=(data.instance?`<details class="player-evidence"><summary>Current instance and creation provenance</summary><pre>${esc(JSON.stringify(data.instance,null,2))}</pre></details>`:"")+(data.rows.length?data.rows.map(renderEvidence).join(""):'<p class="muted">No records match this view. Missing records are not proof that an action never occurred.</p>');
      $("EvidencePage").textContent=`Page ${page+1} · ${data.rows.length} records${data.has_more?" · more available":" · end of results"}`;
      $("EvidencePrevious").disabled=page===0; $("EvidenceNext").disabled=!data.has_more;
      $("Receipt").textContent=`Captured ${when(data.captured_at)} · access receipt #${data.audit.access_id} · response SHA-256 ${data.audit.response_sha256}`;
      $("Export").disabled=false; message("");
    } catch(e) { if(seq===details && gen===generation) { evidence=null; $("Evidence").textContent="Evidence unavailable."; message(e.message); } }
    finally { if(seq===details) busy=false; }
  }
  function renderEvidence(r) {
    const id=r.transaction_ledger_id || r.item_transaction_id || r.gem_ledger_id || r.punishment_id || r.security_event_id || r.admin_action_id || r.item_instance_event_id || r.world_block_change_id || r.world_object_change_id || r.access_id || r.evidence_id || r.world_id || r.rollback_job_id || r.public_item_instance_id;
    const action=r.transaction_type || r.punishment_type || r.event_type || r.action_type || r.action || r.type || r.world_name || r.public_item_instance_id || r.event?.outcome || "record";
    const value=r.quantity ?? r.delta ?? "";
    const links=[];
    if(r.public_item_instance_id) links.push(`<button class="player-link" data-instance="${esc(r.public_item_instance_id)}" type="button">Trace ${esc(r.public_item_instance_id)}</button>`);
    if(r.correlation_id && account) links.push(`<button class="player-link" data-correlation="${esc(r.correlation_id)}" type="button">Related ledger records</button>`);
    if(r.other_player_id) links.push(`<button class="player-link" data-find-player="${esc(r.other_player_id)}" type="button">Find other player</button>`);
    return `<details class="player-evidence"><summary><strong>${esc(action)}</strong> · ${esc(r.item_type || r.relationship || r.source || "")} ${esc(value)}<br><span class="muted">${esc(when(r.server_time || r.created_at || r.last_saved_at))} · #${esc(id)}</span> ${esc(r.effective_status || r.status || r.state || r.severity || "")}${r.hash_verification?` · hash ${esc(r.hash_verification)}`:""}</summary>${r.reason?`<p>${esc(r.reason)}</p>`:""}${r.classification?`<p class="player-coverage">${esc(r.classification.replaceAll("_"," "))}</p>`:""}<div class="player-toolbar">${links.join("")}</div><pre>${esc(JSON.stringify(r,null,2))}</pre></details>`;
  }
  function trace(id) { instance=id.trim().toUpperCase(); if(!instance) { message("Enter a PM-ITEM identifier."); return; } mode="instance"; page=0; history(); }
  $("Search").addEventListener("input",()=>{clearTimeout(timer); ++listing; timer=setTimeout(()=>{offset=0;list();},250);});
  $("Refresh").addEventListener("click",async()=>{await load(true); if(account) await select(account);});
  $("Previous").addEventListener("click",()=>{offset=Math.max(0,offset-size);list();});
  $("Next").addEventListener("click",()=>{offset+=size;list();});
  $("List").addEventListener("click",e=>{const b=e.target.closest("[data-account]");if(b)select(b.dataset.account);});
  $("Trace").addEventListener("click",()=>trace($("Instance").value));
  $("Lifecycle").addEventListener("click",()=>{mode="instance";page=0;history();});
  $("InstanceLedger").addEventListener("click",()=>{mode="instance-ledger";page=0;history();});
  $("Instance").addEventListener("keydown",e=>{if(e.key==="Enter")trace($("Instance").value);});
  $("Access").addEventListener("click",()=>{mode="access";page=0;history();});
  $("Section").addEventListener("change",()=>{mode="player";section=$("Section").value;page=0;clearFilters();history();});
  $("Filters").addEventListener("submit",e=>{e.preventDefault();page=0;history();});
  $("Clear").addEventListener("click",()=>{clearFilters();page=0;history();});
  $("EvidencePrevious").addEventListener("click",()=>{if(!busy){page=Math.max(0,page-1);history();}});
  $("EvidenceNext").addEventListener("click",()=>{if(!busy){page++;history();}});
  document.querySelector(".player-case").addEventListener("click",e=>{
    const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.instance) return trace(b.dataset.instance);
    if(b.dataset.findPlayer) { $("Search").value=b.dataset.findPlayer;offset=0;list();return; }
    if(b.dataset.item || b.dataset.itemInstances || b.dataset.correlation) {
      clearFilters(); mode="player"; section=b.dataset.itemInstances?"instances":"ledger"; $("Section").value=section; page=0;
      $("ItemFilter").value=b.dataset.item || b.dataset.itemInstances || ""; $("RefFilter").value=b.dataset.correlation || "";history();
    }
  });
  $("Export").addEventListener("click",()=>{
    if(!evidence) return;
    const blob=new Blob([JSON.stringify({format:"pixelmania-player-evidence-v1",exported_at:new Date().toISOString(),profile,evidence,scope:"Selected profile plus this evidence page. Follow pagination for remaining records. Each response carries a durable access receipt."},null,2)],{type:"application/json"});
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`pixelmania-evidence-${evidence.request_id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  });
  window.OpsPlayers={load,reset(){generation++;listing++;details++;loaded=false;account=null;profile=null;evidence=null;offset=0;clearTimeout(timer);$("List").replaceChildren();$("Profile").textContent="Select a player to inspect their account and inventory.";$("Evidence").replaceChildren();$("History").classList.add("hidden");}};
})();
