const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudflareClient, validateRecord, CloudflareError } = require('../src/main/cloudflare');
const zone = 'a'.repeat(32), record = 'b'.repeat(32), token = 'labserver_test_token_1234567890123456789012';
const reply = (result, result_info) => new Response(JSON.stringify({success:true,errors:[],messages:[],result,result_info}),{status:200});

test('Cloudflare uses only its HTTPS origin, bearer authentication and all zone pages', async () => {
  const requests=[];
  const client=createCloudflareClient(token, async (url, options) => {
    requests.push({url,options});
    const page=new URL(url).searchParams.get('page');
    return reply([{id:page==='1'?zone:record,name:page==='1'?'example.com':'second.test'}],{page:Number(page),total_pages:2,total_count:2});
  });
  assert.deepEqual((await client.zones()).map(z=>z.name),['example.com','second.test']);
  assert.equal(requests.length,2);
  assert.equal(new URL(requests[0].url).origin,'https://api.cloudflare.com');
  assert.equal(requests[0].options.headers.Authorization,`Bearer ${token}`);
  assert.equal(requests[0].options.redirect,'error');
  await assert.rejects(client.records('../evil'),CloudflareError);
  assert.equal(requests.length,2);
});

test('records support search pagination and PATCH leaves unrelated record settings alone', async () => {
  const requests=[];
  const client=createCloudflareClient(token,async(url,options)=>{requests.push({url,options});return options.method==='GET'?reply([{id:record,type:'A',name:'www.example.com',content:'192.0.2.1',ttl:1}],{page:2,total_pages:3,total_count:250}):reply({id:record});});
  const result=await client.records(zone,{page:2,search:'www & api'});
  assert.equal(result.total,250); assert.equal(result.pages,3);
  assert.equal(new URL(requests[0].url).searchParams.get('search'),'www & api');
  await client.update(zone,record,{type:'A',name:'www.example.com',content:'192.0.2.2',ttl:1,proxied:true});
  assert.equal(requests[1].options.method,'PATCH');
  assert.equal(JSON.parse(requests[1].options.body).content,'192.0.2.2');
  assert.equal(Object.hasOwn(JSON.parse(requests[1].options.body),'tags'),false);
});

test('Cloudflare failures are useful without echoing response secrets or exception details', async () => {
  for(const status of [400,401,403,429,500]) {
    const client=createCloudflareClient(token,async()=>new Response(JSON.stringify({success:false,errors:[{code:10000,message:token}]}),{status}));
    await assert.rejects(client.zones(),error=>error instanceof CloudflareError && !error.message.includes(token));
  }
  const client=createCloudflareClient(token,async()=>{throw new Error(token);});
  await assert.rejects(client.zones(),error=>!error.message.includes(token));
});

test('DNS validation normalizes relative names and enforces IP, TTL, proxy and zone boundaries',()=>{
  assert.deepEqual(validateRecord({type:'A',name:'@',content:'192.0.2.2',ttl:300,proxied:true},'example.com'),{type:'A',name:'example.com',content:'192.0.2.2',ttl:1,proxied:true,comment:''});
  assert.equal(validateRecord({type:'TXT',name:'_acme-challenge',content:'  literal TXT  ',ttl:60},'example.com').content,'  literal TXT  ');
  assert.equal(validateRecord({type:'CNAME',name:'*.example.com.',content:'target.example.net',ttl:1},'example.com').name,'*.example.com');
  for(const input of [
    {type:'A',content:'not an IP'}, {type:'AAAA',content:'192.0.2.1'}, {type:'TXT',content:'hello',proxied:true},
    {type:'MX',content:'mail.example.com',priority:65536}, {type:'CNAME',content:'https://example.com'},
    {type:'A',content:'192.0.2.1',name:'outside.test.'}, {type:'A',content:'192.0.2.1',ttl:0},
    {type:'A',content:'192.0.2.1',name:'bad/name'}, {type:'HTTPS',content:'1 .'},
    {type:'A',content:'192.0.2.1',ttl:true}, {type:'MX',content:'mail.example.com',priority:false},
  ]) assert.throws(()=>validateRecord({name:'@',ttl:1,...input},'example.com'),CloudflareError);
});

test('MX, SRV and CAA structured values survive validation',()=>{
  assert.equal(validateRecord({type:'MX',name:'@',content:'mail.example.com.',priority:10,ttl:1},'example.com').priority,10);
  const data={priority:10,weight:5,port:443,target:'service.example.com'};
  assert.deepEqual(validateRecord({type:'SRV',name:'_https._tcp',data,ttl:1},'example.com').data,data);
  assert.deepEqual(validateRecord({type:'CAA',name:'@',data:{flags:0,tag:'issue',value:'letsencrypt.org'},ttl:1},'example.com').data,{flags:0,tag:'issue',value:'letsencrypt.org'});
  assert.throws(()=>validateRecord({type:'SRV',name:'@',data:{...data,port:-1},ttl:1},'example.com'),CloudflareError);
});
