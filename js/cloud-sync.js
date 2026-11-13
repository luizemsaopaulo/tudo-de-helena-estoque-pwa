"use strict";
// Cloudflare D1 sync: local-first, explicit first migration and password-protected API.
(function () {
  const API = "https://tudo-de-helena-estoque-api.tudo-de-helena-lucilene.workers.dev";
  const TOKEN_KEY = "helena.cloud.lucilene.token.v2";
  const BOOT_KEY = "helena.cloud.lucilene.migrated.v2";
  const STORES = ["products", "rentals", "consumables", "history"];
  let db, appRefresh, dbAll, enabled = false, busy = false, mutating = 0, timer = null;
  let btn, panel, message, loginForm, choices, controls;
  const status = (label, css="") => {
    if (btn) { btn.textContent = "☁ " + (label.length>30?label.slice(0,29)+"…":label); btn.className = "btn ghost helena-cloud-button " + css; }
    if (message) message.textContent = label;
  };
  const errorText = e => (e && e.message) || "Sem conexão com a nuvem.";
  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
  async function call(path, body, method = "GET", useToken = true) {
    const headers = { "Accept":"application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (useToken && token()) headers.Authorization = "Bearer " + token();
    const resp = await fetch(API + path, {method, headers, body:body===undefined?undefined:JSON.stringify(body), cache:"no-store"});
    let data;
    try { data = await resp.json(); } catch { throw new Error("Resposta inválida da Cloudflare."); }
    if (!resp.ok) {
      if (resp.status === 401 && path !== "/api/login") { localStorage.removeItem(TOKEN_KEY); enabled=false; status("Entre novamente", "error"); }
      throw new Error(data.error || "Erro HTTP " + resp.status);
    }
    return data;
  }
  async function getAllQueued() {
    return new Promise((resolve,reject) => {
      const tx=db.transaction("syncQueue","readonly"), req=tx.objectStore("syncQueue").getAll();
      req.onsuccess=()=>resolve(req.result || []);
      req.onerror=()=>reject(req.error);
    });
  }
  async function dropQueued(ids) {
    return new Promise((resolve,reject) => {
      const tx=db.transaction("syncQueue","readwrite");
      for (const id of ids) tx.objectStore("syncQueue").delete(id);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
  async function shrink(record, store) {
    if (store!=="products" || !record?.photo || record.photo.length < 550000 || !record.photo.startsWith("data:image/")) return record;
    const image = new Image();
    image.src = record.photo;
    await image.decode();
    const factor = Math.min(1, 1000 / Math.max(image.width,image.height));
    const canvas = document.createElement("canvas");
    canvas.width=Math.max(1,Math.floor(image.width*factor));canvas.height=Math.max(1,Math.floor(image.height*factor));
    const ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let photo=canvas.toDataURL("image/jpeg",0.78);
    if (photo.length>1300000) photo=canvas.toDataURL("image/jpeg",0.55);
    if (photo.length>1600000) throw new Error("Foto muito grande para D1. Reduza a imagem antes de salvar.");
    return {...record,photo};
  }
  // The local record and its sync-queue entry share one IndexedDB transaction.
  // No local change can be overwritten by a download before it has entered the queue.
  async function persist(store, value, deleted = false) {
    if (!STORES.includes(store) || !value?.id) throw new Error("Registro inválido.");
    const registered = localStorage.getItem(BOOT_KEY)==="1";
    mutating++;
    try {
      const clean=registered && !deleted ? await shrink(value,store) : undefined;
      await new Promise((resolve,reject) => {
        const tx=db.transaction(registered?[store,"syncQueue"]:[store],"readwrite");
        const table=tx.objectStore(store);
        if(deleted) table.delete(value.id); else table.put(value);
        if(registered) tx.objectStore("syncQueue").put({
          id:crypto.randomUUID(),store,recordId:value.id,value:clean,deleted,createdAt:Date.now()
        });
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      if(registered) {
        status(token()?"Pendente de sincronização":"Alterações locais pendentes");
        if(token()) {clearTimeout(timer);timer=setTimeout(()=>syncNow(),600);}
      }
    } catch(e) {
      console.warn("Falha ao salvar no estoque local:",e);
      status("Erro ao salvar: "+errorText(e),"error");
      throw e;
    } finally { mutating--; }
  }
  function backupLocal() {
    const data = {version:3,products:[],rentals:[],consumables:[],history:[]};
    return Promise.all(STORES.map(async store => {data[store]=await dbAll(store)})).then(()=>{
      data.settings=window.HelenaDistance?.exportSettings?.() || null;
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;
      a.download="tudo-de-helena-antes-da-nuvem-"+new Date().toISOString().slice(0,10)+".json";
      a.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
    });
  }
  async function importLocal() {
    status("Enviando cadastros...");
    const operations=[];
    for (const store of STORES) for (const record of await dbAll(store)) operations.push({store,id:record.id,value:await shrink(record,store)});
    for (let i=0;i<operations.length;i+=3) {
      await call("/api/import",{operations:operations.slice(i,i+3)},"POST");
      status("Importando "+Math.min(operations.length,i+3)+"/"+operations.length);
    }
    return operations.length;
  }
  async function replaceFromCloud(data) {
    if (!data || !STORES.every(store=>Array.isArray(data[store]))) throw new Error("Backup remoto inválido.");
    if (mutating) return false;
    // Check pending edits in the SAME transaction that replaces local data.
    // A concurrent edit always serializes against this transaction.
    const applied=await new Promise((resolve,reject)=>{
      const tx=db.transaction([...STORES,"syncQueue"],"readwrite");
      let changed=false;
      const count=tx.objectStore("syncQueue").count();
      count.onsuccess=()=>{
        if(count.result || mutating) return;
        for (const store of STORES) {
          const obj=tx.objectStore(store);
          obj.clear();
          for (const record of data[store]) if (record?.id) obj.put(record);
        }
        changed=true;
      };
      tx.oncomplete=()=>resolve(changed);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error || new Error("Falha ao aplicar a atualização da nuvem."));
    });
    if(applied) await appRefresh();
    return applied;
  }
  async function syncNow() {
    if (!enabled || !token() || busy || mutating) return;
    if (!navigator.onLine) {status("Offline — dados locais","warning");return;}
    busy=true;status("Sincronizando...");
    try {
      let queue = await getAllQueued();
      while (queue.length) {
        const chunk=queue.slice(0,10);
        await call("/api/changes",{operations:chunk.map(x=>({store:x.store,id:x.recordId,value:x.value,deleted:x.deleted}))},"POST");
        await dropQueued(chunk.map(x=>x.id));
        queue=await getAllQueued();
      }
      const result = await call("/api/snapshot");
      const applied=await replaceFromCloud(result.data);
      if(!applied) {
        status("Alterações locais pendentes","warning");
        clearTimeout(timer);timer=setTimeout(()=>syncNow(),1200);
        return;
      }
      localStorage.setItem("helena.cloud.lastsync", new Date().toISOString());
      status("Sincronizado","connected");
    } catch(e) {
      console.warn("Tudo de Helena: sincronização não concluída:",e);
      status("Falha: "+errorText(e),"error");
    } finally {busy=false;}
  }
  function close() {panel?.close();}
  function migrationUI() {
    loginForm.hidden=true;controls.hidden=true;choices.hidden=false;
    status("Escolha como unir os dados");
    const localCounts=STORES.map(async n => (await dbAll(n)).length);
    Promise.all(localCounts).then(counts=>{
      const total=counts.reduce((a,b)=>a+b,0);
      document.querySelector("#cloudLocalCount").textContent=total + " cadastro(s) neste navegador";
      if (!total) document.querySelector("#cloudChooseRemote").click();
    });
  }
  async function startSession() {
    try {
      await call("/api/me");
      loginForm.hidden=true;controls.hidden=false;
      if (localStorage.getItem(BOOT_KEY)!=="1") {
        migrationUI();
      } else {
        enabled=true;choices.hidden=true;await syncNow();
      }
    } catch(e) {
      enabled=false;
      loginForm.hidden=false;controls.hidden=true;choices.hidden=true;
      status("Conectar à nuvem","error");
      if (!navigator.onLine) status("Offline — dados locais","warning");
    }
  }
  async function selectMigration(shouldImport) {
    try {
      choices.hidden=true;status("Criando backup local...");
      let count=0;for(const store of STORES)count+=(await dbAll(store)).length;
      if(count) await backupLocal();
      if(shouldImport) await importLocal();
      localStorage.setItem(BOOT_KEY,"1");
      enabled=true;controls.hidden=false;await syncNow();
      close();
    } catch(e) {choices.hidden=false;status("Erro: "+errorText(e),"error");}
  }
  function makeDialog() {
    btn=document.createElement("button");btn.type="button";btn.className="btn ghost helena-cloud-button";
    const actions=document.querySelector(".top-actions");actions.insertBefore(btn,actions.firstChild);
    panel=document.createElement("dialog");panel.id="cloudDialog";panel.className="modal";
    panel.innerHTML='<div class="modal-card helena-cloud-card"><div class="modal-head"><div><p class="eyebrow">SINCRONIZAÇÃO PRIVADA</p><h2>☁ Tudo de Helena na nuvem</h2></div><button type="button" class="x" id="cloudClose">×</button></div><p class="cloud-help">Seus dados continuam disponíveis neste aparelho. Para sincronizar entre computador e celular, entre com a senha privada da Tudo de Helena.</p><p class="cloud-message" id="cloudMessage"></p><form id="cloudLoginForm"><label class="field"><span>Senha de acesso à nuvem</span><input type="password" id="cloudPassword" autocomplete="current-password" required minlength="6" placeholder="Digite seu PIN ou senha"></label><div class="actions"><button class="btn primary" type="submit">Conectar</button></div></form><div id="cloudChoices" hidden><p class="cloud-help"><strong id="cloudLocalCount"></strong>. Escolha o que fazer antes do primeiro acesso. Um backup JSON será baixado automaticamente.</p><div class="cloud-choices"><button type="button" class="btn primary" id="cloudImport">Enviar dados deste aparelho à nuvem</button><button type="button" class="btn secondary" id="cloudChooseRemote">Usar somente os dados que já estão na nuvem</button></div><small>Ao escolher os dados da nuvem, os locais serão mantidos no arquivo de backup baixado.</small></div><div id="cloudControls" hidden><p class="cloud-help">A sincronização ocorre automaticamente. Seu acesso fica salvo neste navegador e se renova enquanto você usar o aplicativo.</p><div class="cloud-choices"><button class="btn primary" id="cloudSyncNow" type="button">Sincronizar agora</button><button class="btn secondary" id="cloudBackupNow" type="button">Baixar backup local</button><button class="btn ghost" id="cloudLogout" type="button">Desconectar conta</button></div></div></div>';
    document.body.append(panel);
    message=panel.querySelector("#cloudMessage");loginForm=panel.querySelector("#cloudLoginForm");
    choices=panel.querySelector("#cloudChoices");controls=panel.querySelector("#cloudControls");
    btn.onclick=()=>{panel.showModal();if(token())startSession();};
    panel.querySelector("#cloudClose").onclick=close;
    loginForm.onsubmit=async e=>{
      e.preventDefault();
      const password=panel.querySelector("#cloudPassword").value;
      status("Verificando senha...");
      try {
        const result=await call("/api/login",{password},"POST",false);
        localStorage.setItem(TOKEN_KEY,result.token);
        panel.querySelector("#cloudPassword").value="";
        await startSession();
      } catch(e) {status("Erro: "+errorText(e),"error");}
    };
    panel.querySelector("#cloudImport").onclick=()=>selectMigration(true);
    panel.querySelector("#cloudChooseRemote").onclick=()=>selectMigration(false);
    panel.querySelector("#cloudSyncNow").onclick=()=>syncNow();
    panel.querySelector("#cloudBackupNow").onclick=()=>backupLocal();
    panel.querySelector("#cloudLogout").onclick=async()=>{
      try {await call("/api/logout",{},"POST");} catch {}
      localStorage.removeItem(TOKEN_KEY);enabled=false;
      controls.hidden=true;loginForm.hidden=false;choices.hidden=true;
      status("Conta desconectada");close();
    };
  }
  async function init(database, allFn, refreshFn) {
    db=database;dbAll=allFn;appRefresh=refreshFn;makeDialog();
    if (token()) await startSession();
    else status("Conectar à nuvem");
    setInterval(()=>{if(document.visibilityState==="visible")syncNow();},30000);
    window.addEventListener("online",()=>syncNow());
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")syncNow();});
  }
  window.HelenaCloud={init,persist,syncNow,backupLocal};
})();
