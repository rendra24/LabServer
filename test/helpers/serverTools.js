const ID='a'.repeat(64), STOPPED='b'.repeat(64);
function serverToolsFixture(fallback) {
  const commands=[], inputs=[], states=new Map([[ID,'running'],[STOPPED,'exited']]);
  let missing=false, missingShell=false, serial=0, certbotMissing=false, badNginx=false, certbotFailure=false;
  const certificates=new Map([['example.com',{domains:['example.com','www.example.com'],expiry:'2027-10-18 10:00:00+00:00'}],['expiring.example.com',{domains:['expiring.example.com'],expiry:new Date(Date.now()+10*86400000).toISOString().replace('T',' ').slice(0,19)+'+00:00'}],['expired.example.com',{domains:['expired.example.com'],expiry:'2020-01-01 00:00:00+00:00'}],['unknown.example.com',{domains:['unknown.example.com'],expiry:'unknown-date'}]]);
  function execHandler(stream,command) {
    if(!command.includes('docker --host=')&&!command.includes('certbot ')&&!command.includes("' -t")&&!command.includes("' -V"))return fallback(stream,command);
    commands.push(command);stream.on('error',()=>{});
    const reply=(stdout='',code=0,stderr='')=>{if(stdout)stream.write(stdout);if(stderr)stream.stderr.write(stderr);stream.exit(code);stream.end();};
    if(command.includes('certbot ')||command.includes("' -t")||command.includes("' -V")){
      stream.resume();
      if(command.includes("' -t"))return badNginx?reply('',1,'nginx: syntax error'):reply('');
      if(command.includes("' -V"))return reply('',0,'configure arguments: --conf-path=/etc/nginx/nginx.conf');
      if(certbotMissing)return reply('',127,'certbot: not found');
      if(command.includes(' certificates'))return reply('Found the following certs:\n'+[...certificates].map(([name,cert])=>`  Certificate Name: ${name}\n    Domains: ${cert.domains.join(' ')}\n    Expiry Date: ${cert.expiry} (${cert.validity || 'VALID: fixture'})\n    Certificate Path: /etc/letsencrypt/live/${name}/fullchain.pem\n    Private Key Path: /etc/letsencrypt/live/${name}/privkey.pem\n`).join(''));
      if(certbotFailure)return reply('',1,'ACME challenge failed');
      if(command.includes(' --nginx ')){const name=command.match(/--cert-name='([^']+)'/)?.[1];const domains=[...command.matchAll(/-d '([^']+)'/g)].map(match=>match[1]);certificates.set(name,{domains,expiry:'2027-10-18 10:00:00+00:00'});return reply('Successfully deployed certificate');}
      if(command.includes(' renew '))return reply('No renewals were attempted.');
      return reply('',1,'unexpected certbot command');
    }
    if(missing)return reply('',127,'docker: not found');
    const id=command.match(/-- '([a-f0-9]{64})'/)?.[1] || ID;
    if(command.includes('container exec')) {
      if(missingShell)return reply('',127,'exec: shell not found');
      stream.write('root@web:/# ');
      stream.on('data',data=>{inputs.push(Buffer.from(data));stream.write(data);});
      return;
    }
    stream.resume();
    if(command.includes('container ls'))return reply([...states].map(([id,state])=>JSON.stringify({ID:id,Names:id===ID?'web':'db',Image:id===ID?'nginx:alpine':'mysql:8',State:state,Status:state==='running'?'Up 2 hours (healthy)':'Exited (0)',Ports:id===ID?'0.0.0.0:80->80/tcp':''})).join('\n')+'\n');
    if(command.includes('container stats'))return reply([...states].filter(([,state])=>state==='running').map(([id])=>JSON.stringify({ID:id,Name:id===ID?'web':'db',CPUPerc:'2.50%',MemUsage:'32MiB / 1GiB',MemPerc:'3.13%'})).join('\n'));
    if(command.includes('container inspect'))return states.has(id)?reply(JSON.stringify({id,name:id===ID?'/web':'/db',state:{Status:states.get(id),Running:states.get(id)==='running',Pid:123,ExitCode:0,StartedAt:'2026-10-18T00:00:00Z',FinishedAt:'0001-01-01T00:00:00Z',OOMKilled:false}})):reply('',1,'No such container');
    if(command.includes('container logs'))return reply(`2026-10-18T00:00:01Z error: upstream unavailable ${++serial}\n2026-10-18T00:00:02Z info: fixture request\n`);
    const action=command.match(/container (start|stop|restart) /)?.[1];
    if(action){states.set(id,action==='stop'?'exited':'running');return reply(id+'\n');}
    return reply('',1,'unsupported fixture command');
  }
  return{execHandler,commands,inputs,states,certificates,certbotMissing(value){certbotMissing=value;},badNginx(value){badNginx=value;},certbotFailure(value){certbotFailure=value;},ID,STOPPED,unsupported(value){missing=value;},missingShell(value){missingShell=value;}};
}
module.exports={serverToolsFixture,ID,STOPPED};
