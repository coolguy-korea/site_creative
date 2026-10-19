import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
test('게시, 이미지 조회, 감상, 중복 제한, 기간 순위',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'pencil-test-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'3107',DB_PATH:join(temp,'test.sqlite')},stdio:['ignore','pipe','pipe']});
 try{
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('서버 시작 실패');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('서버 시작 시간 초과')),5000).unref())]);
 const request=async(path,data)=>{const r=await fetch('http://127.0.0.1:3107'+path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:undefined);return {status:r.status,data:await r.json()};};
 assert.equal((await fetch('http://127.0.0.1:3107')).status,200);
 assert.equal((await request('/api/posts')).data.length,0);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
 assert.equal((await request('/api/posts',{title:'',author:'나',source:'',image})).status,400);
 const created=await request('/api/posts',{title:'오늘의 필사',author:'연습',source:'느리게 걷기',image});assert.equal(created.status,201);const id=created.data.id;
 const img=await fetch(`http://127.0.0.1:3107/api/posts/${id}/image`);assert.equal(img.headers.get('content-type'),'image/png');assert.ok((await img.arrayBuffer()).byteLength>8);
 assert.equal((await request(`/api/posts/${id}/reviews`,{name:'독자',body:'멋진 글씨',visitor:'browser1',rating:6})).status,400);
 assert.equal((await request(`/api/posts/${id}/reviews`,{name:'독자',body:'멋진 글씨',visitor:'browser1',rating:5})).status,201);
 assert.equal((await request(`/api/posts/${id}/reviews`,{name:'독자',body:'재평가',visitor:'browser1',rating:1})).status,409);
 assert.equal((await request(`/api/posts/${id}/reviews`,{name:'다른 독자',body:'좋아요',visitor:'browser2',rating:3})).status,201);
 for(const period of ['week','month']){const ranked=await request('/api/posts?period='+period);assert.equal(ranked.data[0].rating,4);assert.equal(ranked.data[0].votes,2);}
 const detail=await request('/api/posts/'+id);assert.equal(detail.data.reviews.length,2);assert.equal(detail.data.source,'느리게 걷기');
 assert.equal((await request('/api/posts/missing')).status,404);
 const forbidden=await fetch('http://127.0.0.1:3107/api/posts',{method:'POST',headers:{Origin:'https://elsewhere.example'},body:'{}'});assert.equal(forbidden.status,403);
 }finally{child.kill();await once(child,'exit');await rm(temp,{recursive:true,force:true});}
});
