function systemFixture() {
  const commands = [], closed = [];
  const states = new Map([['nginx.service', 'active'], ['redis.service', 'failed'], ['mysql.service', 'inactive']]);
  let fail = false, holdLogs = false, serial = 0;
  const pending = new Set();
  function execHandler(stream, command) {
    commands.push(command);
    stream.on('error', () => {});
    stream.resume();
    stream.once('close', () => { closed.push(command); pending.delete(stream); });
    function reply(stdout = '', code = 0, stderr = '') { if (stream.destroyed) return; if (stdout) stream.write(stdout); if (stderr) stream.stderr.write(stderr); stream.exit(code); stream.end(); }
    if (fail && (command.includes('systemctl') || command.includes('journalctl'))) return reply('', 127, 'command not found');
    if (command.includes('list-unit-files')) return reply('nginx.service enabled enabled\nredis.service enabled enabled\nmysql.service disabled enabled\n');
    if (command.includes('list-units')) return reply([...states].map(([name, active]) => `${name} loaded ${active} ${active === 'active' ? 'running' : active === 'failed' ? 'failed' : 'dead'} ${name.split('.')[0]} service`).join('\n') + '\n');
    const unit = command.match(/-- '([^']+\.service)'/)?.[1] || 'nginx.service';
    if (command.includes('systemctl') && command.includes('show')) return reply(`Id=${unit}\nDescription=${unit} fixture\nLoadState=loaded\nActiveState=${states.get(unit) || 'inactive'}\nSubState=${states.get(unit) === 'active' ? 'running' : 'dead'}\nUnitFileState=enabled\nMainPID=123\nMemoryCurrent=16777216\nActiveEnterTimestamp=Sat 2026-10-17 10:00:00 UTC\nFragmentPath=/lib/systemd/system/${unit}\nExecMainStatus=0\n`);
    const action = command.match(/(start|stop|restart) --/)?.[1];
    if (action) { states.set(unit, action === 'stop' ? 'inactive' : 'active'); return reply(); }
    if (command.includes('journalctl') || command.includes('tail -n')) {
      if (holdLogs) { pending.add(stream); return; }
      const number = ++serial;
      const error = `2026-10-17T10:00:01+00:00 fixture nginx[123]: [error] upstream connection refused ${number}\n`;
      const warning = `2026-10-17T10:00:02+00:00 fixture nginx[123]: [warn] retrying upstream ${number}\n`;
      const info = `2026-10-17T10:00:03+00:00 fixture nginx[123]: [info] request completed ${number}\n`;
      if (command.includes('missing.log')) return reply('', 66);
      if (command.includes("--priority='err'")) return reply(error);
      if (command.includes("--priority='warning'")) return reply(error + warning);
      return reply(error + warning + info);
    }
    return reply(`ran:${command}\n`);
  }
  return { execHandler, commands, closed, states, unsupported(value) { fail = value; }, hold(value) { holdLogs = value; }, pending };
}
module.exports = { systemFixture };
