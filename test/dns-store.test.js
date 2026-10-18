const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {createStore}=require('../src/main/store');
const {collectBackup,encryptBackup,decryptBackup,restoreBackup}=require('../src/main/backup');
const token='labserver_test_token_1234567890123456789012';
const cryptoImpl={encrypt:s=>Buffer.from(`sealed:${s}`),decrypt:b=>{const s=b.toString(); if(!s.startsWith('sealed:'))throw Error('locked'); return s.slice(7);}};
function setup(t,crypto=cryptoImpl){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labserver-dns-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return{dir,store:createStore(dir,crypto)};}
test('Cloudflare labels persist while stored tokens never appear in profile summaries',t=>{
  const {dir,store}=setup(t);const saved=store.saveCloudflare({memo:'Personal',token});
  assert.deepEqual(Object.keys(saved).sort(),['id','memo']);
  assert.deepEqual(createStore(dir,cryptoImpl).listCloudflare(),[saved]);
  assert.equal(store.getCloudflareToken(saved.id),token);
  assert.equal(fs.readFileSync(path.join(dir,'cloudflare.json'),'utf8').includes(token),false);
  store.saveCloudflare({...saved,memo:'Renamed',token:''});assert.equal(store.getCloudflareToken(saved.id),token);
  store.removeCloudflare(saved.id);assert.deepEqual(store.listCloudflare(),[]);
});
test('invalid credentials and unavailable encryption cannot persist tokens',t=>{
  const {store,dir}=setup(t,null);assert.throws(()=>store.saveCloudflare({memo:'A',token}),/Enkripsi/);
  assert.equal(fs.existsSync(path.join(dir,'cloudflare.json')),false);
  const other=setup(t).store;for(const input of [{memo:'',token},{memo:'A',token:'bad\nheader'},{id:'../evil',memo:'A',token}])assert.throws(()=>other.saveCloudflare(input));
});
test('DNS-only encrypted backups restore credentials and preserve conflicts by default',async t=>{
  const source=setup(t);const account=source.store.saveCloudflare({memo:'Personal',token});
  const bytes=await encryptBackup(collectBackup(source.store),'backup-password-123');
  assert.equal(bytes.includes(token),false);
  const data=await decryptBackup(bytes,'backup-password-123');const dest=setup(t);
  restoreBackup(data,dest.store,dest.dir,'keep');assert.equal(dest.store.getCloudflareToken(account.id),token);
  dest.store.saveCloudflare({...account,memo:'Local'});restoreBackup(data,dest.store,dest.dir,'keep');assert.equal(dest.store.listCloudflare()[0].memo,'Local');
  restoreBackup(data,dest.store,dest.dir,'update');assert.equal(dest.store.listCloudflare()[0].memo,'Personal');
  const old={format:'labserver-data',version:1,createdAt:new Date().toISOString(),servers:[]};
  restoreBackup(old,dest.store,dest.dir,'update');assert.equal(dest.store.getCloudflareToken(account.id),token);
});
test('corrupt account storage and locked credentials are preserved without silent overwrite',t=>{
  const {store,dir}=setup(t);store.saveCloudflare({memo:'A',token});
  assert.throws(()=>collectBackup(createStore(dir,{...cryptoImpl,decrypt:()=>{throw Error('locked');}})),/kredensial/);
  fs.writeFileSync(path.join(dir,'cloudflare.json'),'{broken');
  assert.throws(()=>store.saveCloudflare({memo:'B',token}));assert.equal(fs.readFileSync(path.join(dir,'cloudflare.json'),'utf8'),'{broken');
});
test('failed Cloudflare restore rolls back server profiles, SSH secrets and account tokens together',t=>{
  const {store,dir}=setup(t); const profile=store.save({name:'Existing',host:'192.0.2.1',username:'root',auth:'password'});store.setSecret(profile.id,'password','old-password');const account=store.saveCloudflare({memo:'Existing',token});
  const rename=fs.renameSync;let failOnce=true;t.mock.method(fs,'renameSync',(from,to)=>{if(failOnce&&to===path.join(dir,'cloudflare.json')){failOnce=false;throw Error('disk failure');}return rename(from,to);});
  assert.throws(()=>store.importData([{profile:{...profile,name:'Changed'},credentials:{password:'changed-password'}}],[{...account,memo:'Changed',token:'changed_token_1234567890123456789012345678'}]),/disk failure/);
  assert.equal(store.get(profile.id).name,'Existing');assert.equal(store.getSecret(profile.id,'password'),'old-password');assert.equal(store.listCloudflare()[0].memo,'Existing');assert.equal(store.getCloudflareToken(account.id),token);
  const previous={servers:store.list(),secrets:JSON.parse(fs.readFileSync(path.join(dir,'secrets.json'))),cloudflare:JSON.parse(fs.readFileSync(path.join(dir,'cloudflare.json')))};
  fs.writeFileSync(path.join(dir,'restore-journal.json'),JSON.stringify(previous));fs.writeFileSync(path.join(dir,'cloudflare.json'),'[]');
  assert.equal(createStore(dir,cryptoImpl).getCloudflareToken(account.id),token);
});
