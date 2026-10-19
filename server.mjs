import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(root,'data'),{recursive:true});
const db=new DatabaseSync(process.env.DB_PATH||resolve(root,'data/site.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,source TEXT NOT NULL,image TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,post TEXT REFERENCES posts(id),visitor TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),created INTEGER NOT NULL,UNIQUE(post,visitor));`);
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const limits=new Map();
function allowed(ip){const now=Date.now();const entry=limits.get(ip);if(!entry||now-entry.start>60000){limits.set(ip,{start:now,count:1});if(limits.size>10000)for(const [k,v]of limits)if(now-v.start>60000)limits.delete(k);return true;}return ++entry.count<=30;}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>4_000_000)throw Error('파일이 너무 큽니다.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());}
function str(value,max,required=true){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('입력 내용을 확인해주세요.');return value.trim();}
function boundary(period){const now=new Date(Date.now()+9*3600000);if(period==='month')return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)-9*3600000;if(period==='week'){now.setUTCHours(0,0,0,0);now.setUTCDate(now.getUTCDate()-((now.getUTCDay()+6)%7));return now.getTime()-9*3600000;}return 0;}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/api/posts'){
 const since=boundary(url.searchParams.get('period'));const ranked=['week','month'].includes(url.searchParams.get('period'));
 const rows=db.prepare(`SELECT p.id,p.title,p.author,p.source,p.created,COUNT(r.id) AS votes,COALESCE(AVG(r.rating),0) AS rating FROM posts p LEFT JOIN reviews r ON r.post=p.id WHERE p.created>=? GROUP BY p.id ORDER BY ${ranked?'rating DESC,votes DESC,p.created DESC':'p.created DESC'} LIMIT 100`).all(since);return send(res,200,rows);}
 if(req.method==='GET'&&/^\/api\/posts\/[^/]+\/image$/.test(url.pathname)){const row=db.prepare('SELECT image FROM posts WHERE id=?').get(url.pathname.split('/')[3]);if(!row)return send(res,404,{error:'작품이 없습니다.'});const buf=Buffer.from(row.image.split(',')[1],'base64');res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=3600'});return res.end(buf);}
 if(req.method==='GET'&&/^\/api\/posts\/[^/]+$/.test(url.pathname)){const id=url.pathname.split('/')[3];const post=db.prepare('SELECT id,title,author,source,created FROM posts WHERE id=?').get(id);if(!post)return send(res,404,{error:'작품이 없습니다.'});return send(res,200,{...post,reviews:db.prepare('SELECT name,body,rating,created FROM reviews WHERE post=? ORDER BY created DESC').all(id)});}
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
 if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return send(res,403,{error:'허용되지 않은 요청입니다.'});
 if(!allowed(req.socket.remoteAddress))return send(res,429,{error:'잠시 후 다시 시도해주세요.'});
 const data=await body(req);
 if(url.pathname==='/api/posts'){const title=str(data.title,80),author=str(data.author,30),source=str(data.source,3000,false);if(typeof data.image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.image)||!Buffer.from(data.image.split(',')[1],'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('PNG 필사 이미지가 필요합니다.');const id=randomUUID();db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?)').run(id,title,author,source,data.image,Date.now());return send(res,201,{id});}
 if(/^\/api\/posts\/[^/]+\/reviews$/.test(url.pathname)){const post=url.pathname.split('/')[3];if(!db.prepare('SELECT id FROM posts WHERE id=?').get(post))return send(res,404,{error:'작품이 없습니다.'});const name=str(data.name,30),text=str(data.body,1000),visitor=str(data.visitor,80);if(!Number.isInteger(data.rating)||data.rating<1||data.rating>5)throw Error('별점을 선택해주세요.');try{db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)').run(randomUUID(),post,visitor,name,text,data.rating,Date.now());}catch(e){if(e.message.includes('UNIQUE'))return send(res,409,{error:'이 브라우저에서 이미 감상을 남겼습니다.'});throw e;}return send(res,201,{ok:true});}
 }
 if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});return res.end(readFileSync(resolve(root,'public',file)));}
 send(res,404,{error:'찾을 수 없습니다.'});
 }catch(e){send(res,400,{error:e instanceof SyntaxError?'요청 형식이 올바르지 않습니다.':e.message.includes('입력')||e.message.includes('필사')||e.message.includes('별점')||e.message.includes('파일')?e.message:'요청을 처리하지 못했습니다.'});}});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Pencil Letter server ready'));
