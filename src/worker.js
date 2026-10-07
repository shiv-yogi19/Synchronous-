const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/api/ice") return json({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }] });
    if (u.pathname === "/api/room" && req.method === "POST") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const token = crypto.randomUUID();
      const r = await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://r/init", { method: "POST", body: token });
      if (!r.ok) return json({ error: "retry" }, 409);
      return json({ code, token });
    }
    const m = u.pathname.match(/^\/api\/room\/(\d{6})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch("https://r/info");
    if (u.pathname === "/ws") {
      const code = u.searchParams.get("code") || "";
      if (!/^\d{6}$/.test(code)) return json({ error: "Invalid room code" }, 400);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
const MAX = 8, LOCK = 19000;
export class Room {
  constructor(ctx) { this.ctx = ctx; this.s = ctx.storage; }
  async fetch(req) {
    const u = new URL(req.url), tok = await this.s.get("token");
    if (u.pathname === "/init") { if (tok) return new Response("", { status: 409 }); await this.s.put("token", await req.text()); return new Response("ok"); }
    if (u.pathname === "/info") {
      if (!tok) return json({ error: "Room does not exist" }, 404);
      return json({ clients: this.ctx.getWebSockets("client").length, max: MAX });
    }
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const role = u.searchParams.get("role"), pair = new WebSocketPair();
    let att, old = [];
    if (!tok) return json({ error: "Room does not exist" }, 404);
    if (role === "host") {
      if (u.searchParams.get("token") !== tok) return json({ error: "Not authorized" }, 403);
      old = this.ctx.getWebSockets("host");
      att = { id: "host", role, name: "Host" };
    } else {
      if (!this.ctx.getWebSockets("host").length && !(await this.s.get("hostSeen"))) return json({ error: "Host not connected" }, 404);
      if (this.ctx.getWebSockets("client").length >= MAX) return json({ error: "ROOM FULL" }, 409);
      att = { id: crypto.randomUUID().slice(0, 8), role: "client", name: (u.searchParams.get("name") || "Guest").slice(0, 24) };
    }
    this.ctx.acceptWebSocket(pair[1], [att.role]);
    pair[1].serializeAttachment(att);
    old.forEach(x => x.close(4000, "replaced"));
    if (att.role === "host") await this.s.put("hostSeen", 1);
    const c = await this.cfg();
    pair[1].send(JSON.stringify({ type: "room-joined", id: att.id, role: att.role, lockMs: Math.max(0, c.lockUntil - Date.now()), guest: c.guest, dl: c.dl }));
    if (att.role === "client") this.toHost({ type: "peer-joined", id: att.id, name: att.name });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  toHost(o) { this.ctx.getWebSockets("host").forEach(w => { try { w.send(JSON.stringify(o)); } catch (e) { console.error(e); } }); }
  all(o) { this.ctx.getWebSockets().forEach(w => { try { w.send(JSON.stringify(o)); } catch (e) { console.error(e); } }); }
  async cfg() { const m = await this.s.get(["lockUntil", "guest", "dl"]); return { lockUntil: m.get("lockUntil") || 0, guest: !!m.get("guest"), dl: !!m.get("dl") }; }
  async webSocketMessage(ws, data) {
    const a = ws.deserializeAttachment(), er = e => ws.send(JSON.stringify({ type: "error", error: e }));
    if (typeof data !== "string" || data.length > 20000) return er("Bad message");
    let m; try { m = JSON.parse(data); } catch (e) { return er("Bad JSON"); }
    if (!m || typeof m.type !== "string") return er("Bad message");
    const c = await this.cfg(), find = id => this.ctx.getWebSockets("client").find(x => x.deserializeAttachment().id === id);
    if (a.role === "host") {
      if (m.type === "offer" || m.type === "ice-candidate") {
        const t = find(m.to);
        if (t) t.send(JSON.stringify({ type: m.type, from: "host", sdp: m.sdp, c: m.c }));
      } else if (m.type === "ctl" && ["pause", "next", "prev"].includes(m.cmd)) {
        await this.s.put("lockUntil", Date.now() + LOCK); this.all({ type: "lock-update", lockMs: LOCK });
      } else if (m.type === "permission-update") {
        await this.s.put("guest", !!m.guest); await this.s.put("dl", !!m.dl);
        this.all({ type: "permission-update", guest: !!m.guest, dl: !!m.dl });
      } else if (m.type === "kick") {
        const t = find(m.to); if (t) t.close(4001, "removed");
      }
    } else {
      if (m.type === "answer" || m.type === "ice-candidate") this.toHost({ type: m.type, from: a.id, sdp: m.sdp, c: m.c });
      else if (m.type === "request" && ["play", "pause", "next", "prev"].includes(m.cmd)) {
        if (!c.guest) return er("Guest controls are off");
        if (Date.now() < c.lockUntil) return er("Controls locked by host");
        this.toHost({ type: "request", from: a.id, cmd: m.cmd });
      } else if (m.type === "download-request") {
        if (!c.dl) return er("Song download is off");
        this.toHost({ type: "download-request", from: a.id });
      }
    }
  }
  async webSocketClose(ws) {
    const a = ws.deserializeAttachment();
    if (a.role === "host") {
      if (this.ctx.getWebSockets("host").some(w => w !== ws)) return;
      this.all({ type: "host-disconnected" });
      this.ctx.getWebSockets().forEach(w => { try { w.close(1000, "host left"); } catch (e) { console.error(e); } });
      await this.s.deleteAll();
    } else this.toHost({ type: "peer-left", id: a.id });
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}
