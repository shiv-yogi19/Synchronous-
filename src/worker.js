export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/room" && request.method === "POST") {
        const code = randomCode();
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        const r = await stub.fetch(new Request("https://room/create", {method:"POST"}));
        if (!r.ok) return new Response("Room creation failed", {status:500});
        const data = await r.json();
        return Response.json({code, token:data.token});
      }
      if (url.pathname.startsWith("/api/room/") && request.method === "GET") {
        const code = url.pathname.split("/").pop();
        if (!/^\d{6}$/.test(code)) return new Response("Invalid room", {status:400});
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        return stub.fetch(new Request("https://room/info"));
      }
      if (url.pathname === "/ws") {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", {status:426});
        const code = url.searchParams.get("code") || "";
        const role = url.searchParams.get("role") || "";
        const token = url.searchParams.get("token") || "";
        if (!/^\d{6}$/.test(code) || !["host","client"].includes(role)) return new Response("Bad request",{status:400});
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        return stub.fetch(new Request("https://room/ws?role="+encodeURIComponent(role)+"&token="+encodeURIComponent(token), request));
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("SYNCWAVE", {status:200});
    } catch (e) {
      return new Response("Server error", {status:500});
    }
  }
};

function randomCode(){return String(Math.floor(100000+Math.random()*900000));}

export class Room {
  constructor(state) { this.state=state; this.sessions=new Map(); this.hostToken=null; this.created=Date.now(); }
  async fetch(request){
    const url=new URL(request.url);
    if(request.method==="POST" && url.pathname==="/create"){
      if(!this.hostToken)this.hostToken=crypto.randomUUID();
      return Response.json({token:this.hostToken});
    }
    if(request.method==="GET" && url.pathname==="/info"){
      return Response.json({ok:!!this.hostToken,clients:this.sessions.size});
    }
    if(url.pathname==="/ws"){
      const role=url.searchParams.get("role"), token=url.searchParams.get("token");
      if(role==="host" && token!==this.hostToken) return new Response("Unauthorized",{status:401});
      if(role==="client" && !this.hostToken) return new Response("Room not found",{status:404});
      if(role==="client" && this.sessions.size>=8)return new Response("Room full",{status:409});
      const pair=new WebSocketPair(), client=pair[0], server=pair[1]; server.accept();
      const sid=crypto.randomUUID(); this.sessions.set(sid,{ws:server,role});
      server.send(JSON.stringify({type:"welcome",id:sid,role}));
      server.addEventListener("message",async e=>{
        let m; try{m=JSON.parse(e.data)}catch{return}
        if(m.type==="guest-command" && role==="client"){
          this.sendHost({...m,from:sid,type:"guest-command"});
        } else if(m.to){
          const target=this.sessions.get(m.to);
          if(target)target.ws.send(JSON.stringify({...m,from:sid}));
        } else if(m.type==="host-state" && role==="host"){
          this.broadcast({...m});
        } else if(m.type==="file-request" && role==="client"){
          this.sendHost({type:"file-request",from:sid});
        }
      });
      server.addEventListener("close",()=>this.leave(sid));
      server.addEventListener("error",()=>this.leave(sid));
      if(role==="client")this.sendHost({type:"peer-joined",id:sid});
      return new Response(null,{status:101,webSocket:client});
    }
    return new Response("Not found",{status:404});
  }
  sendHost(m){for(const s of this.sessions.values())if(s.role==="host")s.ws.send(JSON.stringify(m))}
  broadcast(m){for(const s of this.sessions.values())if(s.role==="client")s.ws.send(JSON.stringify(m))}
  leave(id){const s=this.sessions.get(id);if(!s)return;this.sessions.delete(id);if(s.role==="client")this.sendHost({type:"peer-left",id});else{for(const x of this.sessions.values())x.ws.close(1000,"Host disconnected");this.sessions.clear();this.hostToken=null}}
}