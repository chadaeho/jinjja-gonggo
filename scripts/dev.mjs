/** 로컬 개발 서버 — Vercel 없이 public/ + api/ 를 그대로 구동 */
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = process.cwd();
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".json":"application/json",".css":"text/css",".svg":"image/svg+xml"};
const srv=http.createServer(async (req,res)=>{
  const u=new URL(req.url,"http://x"); let p=u.pathname;
  if(p.startsWith("/api/")){
    const f=path.join(root,"api",p.slice(5).replace(/[^\w-]/g,"")+".js");
    if(!fs.existsSync(f)){res.writeHead(404).end("no api");return}
    const mod=await import("file://"+f+"?t="+Date.now());
    let body="";for await(const c of req)body+=c;
    req.body=body;
    const wrap={statusCode:200,_h:{},setHeader(k,v){this._h[k]=v},status(c){this.statusCode=c;return this},
      json(o){res.writeHead(this.statusCode,{...this._h,"Content-Type":"application/json; charset=utf-8"});res.end(JSON.stringify(o))},
      end(s){res.writeHead(this.statusCode,this._h);res.end(s)}};
    try{await mod.default(req,wrap)}catch(e){res.writeHead(500).end(String(e))}
    return;
  }
  if(p==="/")p="/index.html";
  const f=path.join(root,"public",p);
  if(!fs.existsSync(f)){res.writeHead(404).end("404");return}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"});
  fs.createReadStream(f).pipe(res);
});
srv.listen(3000,()=>console.log("http://localhost:3000"));
