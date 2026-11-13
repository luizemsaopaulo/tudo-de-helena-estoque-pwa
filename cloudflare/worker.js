const STORES = new Set(["products", "rentals", "consumables", "history"]);
const ALLOWED_ORIGIN = "https://luizemsaopaulo.github.io";
const enc = new TextEncoder();
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
function cors(req, res) {
  const origin = req.headers.get("Origin");
  const own = new URL(req.url).origin;
  if (origin === ALLOWED_ORIGIN || origin === own) {
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    h.set("Vary", "Origin");
    return new Response(res.body, { status: res.status, headers: h });
  }
  return res;
}
function hex(b) { return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function sha(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function equal(a,b) {
  if (a.length !== b.length) return false;
  let v = 0; for (let i = 0; i < a.length; i++) v |= a.charCodeAt(i) ^ b.charCodeAt(i); return v === 0;
}
function token() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
const err = (m, n = 400) => json({ error:m }, n);
const valid = o => o && typeof o === "object" && !Array.isArray(o);
async function readJSON(req, max = 8000000) {
  if (Number(req.headers.get("content-length") || 0) > max) throw new Error("Payload acima do limite.");
  const raw = await req.text(); if (raw.length > max) throw new Error("Payload acima do limite.");
  return JSON.parse(raw);
}
async function login(req, env) {
  const ip = (req.headers.get("CF-Connecting-IP") || "unknown").slice(0,128);
  const cutoff = Date.now() - 15 * 60 * 1000;
  const blocked = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip=? AND time_ms>?").bind(ip,cutoff).first();
  if (blocked?.n >= 5) return err("Muitas tentativas. Tente novamente em 15 minutos.",429);
  const globalAttempts = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE time_ms>?").bind(cutoff).first();
  if (globalAttempts?.n >= 80) return err("Limite temporário de tentativas atingido. Tente novamente em 15 minutos.",429);
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 6) return err("A senha do servidor não foi configurada.",503);
  const data = await readJSON(req, 3000);
  if (typeof data.password !== "string" || data.password.length > 512) return err("Senha inválida.");
  const approved = equal(await sha(data.password), await sha(env.ADMIN_PASSWORD || ""));
  if (!approved) {
    await env.DB.prepare("INSERT INTO attempts (ip,time_ms) VALUES (?,?)").bind(ip,Date.now()).run();
    return err("Senha incorreta.",401);
  }
  await env.DB.prepare("DELETE FROM attempts WHERE ip=?").bind(ip).run();
  const value = token();
  const expires = Date.now() + 30 * 86400000;
  await env.DB.prepare("INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)").bind(await sha(value),expires).run();
  return json({ token:value, expiresAt:expires, account:"Tudo de Helena" });
}
async function session(req, env) {
  const header = req.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ") || header.length > 160) return false;
  const value = header.slice(7);
  if (!/^[0-9a-f]{64}$/.test(value)) return false;
  const digest = await sha(value);
  const s = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash=?").bind(digest).first();
  const now = Date.now();
  if (!s || s.expires_at <= now) return false;
  // Sliding expiration: no need to type the PIN again while this device is used regularly.
  if (s.expires_at < now + 15 * 86400000) {
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(now + 30 * 86400000,digest).run();
  }
  return true;
}
function validateOperation(o, isImport = false) {
  if (!valid(o) || !STORES.has(o.store) || typeof o.id !== "string" || o.id.length < 1 || o.id.length > 128) return "Registro inválido.";
  if (!isImport && o.deleted === true) return null;
  if (!valid(o.value) || o.value.id !== o.id || JSON.stringify(o.value).length > 1700000) return "Registro ou foto muito grande (máximo 1,7 MB).";
  return null;
}
async function handle(req, env) {
  const url = new URL(req.url);
  if (url.pathname === "/api/health") return json({ ok:true, storage:"D1", protected:true });
  if (req.method === "POST" && url.pathname === "/api/login") return login(req,env);
  if (!(await session(req, env))) return err("Sessão não autorizada. Entre novamente.",401);
  if (req.method === "GET" && url.pathname === "/api/me") return json({ ok:true, account:"Tudo de Helena" });
  if (req.method === "POST" && url.pathname === "/api/logout") {
    const h=req.headers.get("Authorization");await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha(h.slice(7))).run();
    return json({ok:true});
  }
  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    const rows=await env.DB.prepare("SELECT store, content FROM records WHERE deleted=0 ORDER BY store,id").all();
    const data={products:[],rentals:[],consumables:[],history:[]};
    for (const row of rows.results || []) {
      if (!STORES.has(row.store)) continue;
      try { data[row.store].push(JSON.parse(row.content)); } catch {}
    }
    return json({data, serverTime:Date.now()});
  }
  if (req.method === "POST" && ["/api/changes","/api/import"].includes(url.pathname)) {
    const importing=url.pathname === "/api/import";
    const data=await readJSON(req,8500000);
    if (!Array.isArray(data.operations) || !data.operations.length || data.operations.length > 15) return err("Envie de 1 a 15 alterações.");
    const statements=[];
    for (const op of data.operations) {
      const problem=validateOperation(op,importing);
      if (problem) return err(problem);
      const content=op.deleted?null:JSON.stringify(op.value);
      if (importing) {
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO records (store,id,content,deleted,updated_ms) VALUES (?,?,?,?,?)").bind(op.store,op.id,content,0,Date.now()));
      } else {
        statements.push(env.DB.prepare("INSERT INTO records (store,id,content,deleted,updated_ms) VALUES (?,?,?,?,?) ON CONFLICT(store,id) DO UPDATE SET content=excluded.content,deleted=excluded.deleted,updated_ms=excluded.updated_ms").bind(op.store,op.id,content,op.deleted?1:0,Date.now()));
      }
    }
    await env.DB.batch(statements);
    return json({ok:true,count:statements.length});
  }
  return err("Rota não encontrada.",404);
}
export default {
  async fetch(req, env) {
    const origin=req.headers.get("Origin");
    const own=new URL(req.url).origin;
    if (origin && origin !== ALLOWED_ORIGIN && origin !== own) return err("Origem não permitida.",403);
    if (req.method==="OPTIONS") return cors(req,new Response(null,{status:204}));
    try {
      return cors(req,await handle(req,env));
    } catch(e) {
      console.error("Cloud API error:",e?.message);
      if (e instanceof SyntaxError) return cors(req,err("JSON inválido."));
      if (/limite|grande/.test(e?.message||"")) return cors(req,err(e.message,413));
      return cors(req,err("Erro interno na sincronização.",500));
    }
  }
};
