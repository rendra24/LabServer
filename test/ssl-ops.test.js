const test=require('node:test'),assert=require('node:assert/strict');
const {toolSsh}=require('./helpers/toolSsh');
const {createToolRunner}=require('../src/main/tool-runner');
const {createSslOps,parseCertificates}=require('../src/main/ssl-ops');
const certs=`Found the following certs:\n  Certificate Name: example.com\n    Serial Number: 1234\n    Key Type: ECDSA\n    Domains: example.com www.example.com\n    Expiry Date: 2027-10-18 10:00:00+00:00 (VALID: 365 days)\n    Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem\n    Private Key Path: /etc/letsencrypt/live/example.com/privkey.pem\n`;
const profile={username:'root',nginx:{nginxBin:'/usr/sbin/nginx'}};
function fixture(handler){
 const commands=[];const ssh=toolSsh((command,stdin,stream)=>{commands.push(command);const result=handler?.(command,stdin,stream);if(result!==undefined)return result;return{stdout:command.includes(' certificates')?certs:command.includes(' -V')?'':command.includes(' renew ')?'No renewals were attempted.\n':'',stderr:command.includes(' -V')?'nginx version: nginx/1.24.0\nconfigure arguments: --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf':command.includes(' -t')?'nginx: configuration file /etc/nginx/nginx.conf test is successful':'',code:0};});
 const runner=createToolRunner(ssh.conn,profile);return{...ssh,commands,runner,ops:createSslOps(runner,profile)};
}
const issue={domains:['example.com','www.example.com'],email:'owner@example.com',redirect:true,agreeTerms:true};
test('SSL parses metadata and malformed dates remain unknown without private key paths in API',async()=>{
 const parsed=parseCertificates(certs);assert.equal(parsed[0].name,'example.com');assert.deepEqual(parsed[0].domains,['example.com','www.example.com']);assert.equal(parsed[0].expiresAt,Date.UTC(2027,9,18,10));
 const s=fixture();const listing=await s.ops.request('list',{});assert.equal(listing.certificates.length,1);assert.equal(JSON.stringify(listing).includes('privkey'),false);
 assert.equal(parseCertificates(certs.replace('2027-10-18 10:00:00+00:00','invalid-date'))[0].expiresAt,null);
 assert.throws(()=>parseCertificates('unexpected response'),e=>e.code==='BAD_RESPONSE');
});
test('SSL rejects invalid domains email consent and names before running SSH commands',async()=>{
 const s=fixture();for(const input of [{...issue,agreeTerms:false},{...issue,domains:['*.example.com']},{...issue,domains:['--all']},{...issue,domains:['example.com;reboot']},{...issue,email:'x\nreboot@example.com'},{...issue,redirect:'yes'}])await assert.rejects(s.ops.request('issue',input),e=>e.code==='INVALID_REQUEST');
 await assert.rejects(s.ops.request('renew',{name:'../../other'}),e=>e.code==='INVALID_REQUEST');assert.equal(s.commands.length,0);
});
test('SSL cancelled confirmation never reads or changes server certificates',async()=>{
 const s=fixture();await assert.rejects(s.ops.request('issue',issue,{confirm:async()=>false}),e=>e.code==='CANCELLED');assert.equal(s.commands.length,0);
});
test('SSL issuance validates nginx root and SAN coverage then invalidates old syntax before Certbot',async()=>{
 const s=fixture();const changes=[];const result=await s.ops.request('issue',issue,{confirm:async()=>true,nginxChanged:()=>changes.push(s.commands.length)});
 const command=s.commands.find(c=>c.includes(' --nginx '));assert.ok(command.includes("--nginx-ctl='/usr/sbin/nginx'")&&command.includes("--nginx-server-root='/etc/nginx'"));
 assert.ok(command.includes('--keep-until-expiring')&&command.includes('--redirect')&&!command.includes('--force-renewal'));
 assert.ok(changes.length===1 && s.commands[changes[0]].includes(' --nginx '));assert.equal(s.commands.filter(c=>c.includes(' -t')).length,2);assert.equal(result.certificates[0].name,'example.com');
});
test('SSL cannot silently replace a same-name certificate with fewer SAN domains',async()=>{
 const s=fixture();await assert.rejects(s.ops.request('issue',{...issue,domains:['example.com']},{confirm:async()=>true}),e=>e.code==='CERTIFICATE_CONFLICT');assert.equal(s.commands.some(c=>c.includes(' --nginx ')),false);
});
test('SSL preflight syntax errors and unsafe nginx root prevent any issuance',async()=>{
 for(const [handler,code] of [[c=>c.includes(' -t')?{code:1,stderr:'syntax error SECRET'}:undefined,'NGINX_INVALID'],[c=>c.includes(' -V')?{code:0,stderr:'configure arguments: --conf-path=relative.conf'}:undefined,'NGINX_ROOT']]){
  const s=fixture(handler);await assert.rejects(s.ops.request('issue',issue,{confirm:async()=>true}),e=>e.code===code&&!e.message.includes('SECRET'));assert.equal(s.commands.some(c=>c.includes(' --nginx ')),false);
 }
});
test('SSL renewal selects exactly one certificate without force and reports when not due',async()=>{
 const s=fixture();const result=await s.ops.request('renew',{name:'example.com'},{confirm:async()=>true});
 const command=s.commands.find(c=>c.includes(' renew '));assert.ok(command.includes("--cert-name='example.com'")&&!command.includes('--force-renewal'));assert.equal(result.renewed,false);assert.match(result.notice,/belum|tidak/i);
});
test('SSL rejects a custom nginx configuration basename before Certbot can change a different config',async()=>{
 const s=fixture(c=>c.includes(' -V')?{code:0,stderr:'configure arguments: --conf-path=/etc/nginx/custom.conf'}:undefined);let changed=0;
 await assert.rejects(s.ops.request('issue',issue,{confirm:async()=>true,nginxChanged:()=>changed++}),e=>e.code==='NGINX_ROOT');
 assert.equal(s.commands.some(c=>c.includes(' --nginx ')),false);assert.equal(changed,0);
});
test('SSL failed Certbot and late confirmation after dispose cannot issue or imply rollback',async()=>{
 const s=fixture(c=>c.includes(' --nginx ')?{code:1,stderr:'challenge failed SECRET'}:undefined);let changed=0;
 await assert.rejects(s.ops.request('issue',issue,{confirm:async()=>true,nginxChanged:()=>changed++}),e=>e.code==='SSL_FAILED'&&e.message.includes('sebagian')&&!e.message.includes('SECRET'));assert.equal(changed,1);
 const late=fixture();let approve;const pending=late.ops.request('issue',issue,{confirm:()=>new Promise(r=>approve=r)});late.runner.dispose();approve(true);await assert.rejects(pending,e=>e.code==='CANCELLED');assert.equal(late.commands.length,0);
});
