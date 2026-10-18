const { NginxError } = require("./nginx");
const { failure } = require("./services");
const { RANGES } = require("./monitor-catalog");
const { PromError } = require("./prometheus");
const { createTerminal } = require("./terminal");
const { createSystemOps, SystemError } = require('./system-ops');
const { createToolRunner, ToolError } = require('./tool-runner');
const { createDockerOps } = require('./docker-ops');
const { createSslOps } = require('./ssl-ops');
const { createForwarding } = require('./forwarding');

const MAX_CONTENT = 1_048_576;
const isName = (v) => typeof v === "string" && v.length <= 255;
const isContent = (v) => typeof v === "string" && v.length <= MAX_CONTENT && !v.includes("\0");

// Operasi yang boleh dipanggil renderer, beserta validator argumennya.
const OPS = {
  list: [],
  read: [isName],
  write: [isName, isContent],
  create: [isName, isContent],
  enable: [isName],
  disable: [isName],
  test: [],
  reload: [],
};

const notConnected = { ok: false, code: "NOT_CONNECTED", message: "Koneksi ke server terputus. Hubungkan ulang." };
const isConnectionLoss = (e) => /not connected|no response from server|ECONNRESET|channel open failure|socket/i.test(e?.message || "");

/** Satu sesi SSH (koneksi + operasi Nginx) per server, hidup di main process. */
function createSessionManager({ open, getProfile, makeOps, makeMonitor, askSudoPassword, history }) {
  const sessions = new Map();
  const ticket = (session,id,feature) => session.cacheBusy.get(feature) ? null : history?.begin(id,feature,session.historyKey);
  function success(session,id,data,readTicket) {
    if(sessions.get(id)!==session)return notConnected;
    const saved=readTicket&&!session.cacheBusy.get(readTicket.feature)?history?.save(readTicket,data):null;
    return {ok:true,data,...(saved?{history:saved}:{})};
  }
  function reserveHistory(session,features) {
    for(const feature of features)session.cacheBusy.set(feature,(session.cacheBusy.get(feature)||0)+1);
    return()=>{for(const feature of features)session.cacheBusy.set(feature,session.cacheBusy.get(feature)-1);};
  }
  function confirming(id,session,context,features) {
    return {...context,confirm:async(...args)=>{const approved=await context?.confirm?.(...args);if(approved && sessions.get(id)===session)history?.invalidate(id,features);return approved;}};
  }

  function close(id) {
    const s = sessions.get(id);
    sessions.delete(id);
    s?.terminal.dispose();
    s?.system.dispose();
    s?.toolRunner.dispose();
    s?.forwarding.dispose();
    s?.conn.end();
  }

  function acquireWrite(id) {
    const session = sessions.get(id);
    if (!session) throw new ToolError('NOT_CONNECTED');
    if (session.sslPending) throw new ToolError('BUSY');
    session.writes++;
    let released = false;
    return () => { if (!released) { released = true; session.writes--; } };
  }
  return {
    acquireWrite,
    sslBusy: id => Boolean(sessions.get(id)?.sslPending),
    connection: (id) => sessions.get(id)?.conn || null,
    forwarding: id => sessions.get(id)?.forwarding || null,
    snapshot(id,feature) {const session=sessions.get(id);return session?history?.read(id,feature,session.historyKey)||null:null;},
    hasTunnels: id => [...sessions.entries()].some(([key,session]) => (!id || key === id) && session.forwarding.hasActive()),
    isConnected: (id) => sessions.has(id),
    close,
    closeAll: () => [...sessions.keys()].forEach(close),
    busyActions: id => [...sessions.entries()].some(([key, session]) => (!id || key === id) && (session.docker.active() || session.sslPending)),

    async connect(id, creds, onTerminalEvent) {
      const profile = getProfile(id);
      if (!profile) return { ok: false, code: "NOT_FOUND", message: "Server tidak ditemukan." };
      close(id);
      try {
        const conn = await open(id, creds);
        const ops = makeOps(conn, profile, { askSudoPassword: () => askSudoPassword(id) });
        const terminal = createTerminal(conn, { onEvent: onTerminalEvent, username: profile.username });
        const system = createSystemOps(conn, profile);
        const toolRunner = createToolRunner(conn, profile), docker = createDockerOps(toolRunner), ssl = createSslOps(toolRunner, profile);
        const forwarding = createForwarding(conn, () => { if (sessions.get(id)?.conn === conn) onTerminalEvent?.({type:'tunnels-changed'}); });
        sessions.set(id, { conn, ops, monitor: makeMonitor?.(conn, profile), terminal, system, toolRunner, docker, ssl, forwarding, sslPending: false, writes: 0, cacheBusy:new Map(),historyKey:history?.key(id,profile) });
        conn.client.on("close", () => {
          terminal.dispose();
          system.dispose();
          toolRunner.dispose();
          forwarding.dispose();
          if (sessions.get(id)?.conn === conn) {
            sessions.delete(id);
            try { onTerminalEvent?.({ type: "disconnected" }); } catch { /* Renderer mungkin sudah ditutup. */ }
          }
        });
        return { ok: true };
      } catch (e) {
        return failure(e);
      }
    },

    terminal(id, op, ...args) {
      const s = sessions.get(id);
      return s ? s.terminal.request(op, ...args) : notConnected;
    },
    async system(id, op, input, context) {
      if (!['services', 'detail', 'action', 'logs'].includes(op)) return { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan tidak valid.' };
      const session = sessions.get(id);
      if (!session) return notConnected;
      let release = () => {};
      const readTicket=op==='services'?ticket(session,id,'services'):null;
      const releaseHistory=op==='action'?reserveHistory(session,['services']):()=>{};
      try {
        if (op === 'action' && ['nginx','nginx.service'].includes(input?.unit)) release = acquireWrite(id);
        const data = await session.system.request(op, input, op==='action'?confirming(id,session,context,['services']):context);
        return success(session,id,data,readTicket);
      } catch (error) {
        if (sessions.get(id) !== session) return notConnected;
        if (error instanceof SystemError || error instanceof ToolError) return { ok: false, code: error.code, message: error.message, ...(error.code === 'CANCELLED' ? { cancelled: true } : {}) };
        return failure(error);
      } finally { release();releaseHistory(); }
    },

    async docker(id, op, input, context) {
      const session = sessions.get(id);
      if (!session) return notConnected;
      const readTicket=op==='list'?ticket(session,id,'docker'):null;
      const releaseHistory=op==='action'?reserveHistory(session,['docker']):()=>{};
      try {
        const data = await session.docker.request(op, input, op==='action'?confirming(id,session,context,['docker']):context);
        return success(session,id,data,readTicket);
      } catch (error) {
        if (sessions.get(id) !== session) return notConnected;
        if (error instanceof ToolError) return { ok: false, code: error.code, message: error.message, ...(error.code === 'CANCELLED' ? { cancelled: true } : {}) };
        return failure(error);
      } finally {releaseHistory();}
    },

    async ssl(id, op, input, context = {}) {
      const session = sessions.get(id);
      if (!session) return notConnected;
      if (!['list','issue','renew'].includes(op)) return { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan tidak valid.' };
      const mutation = op !== 'list';
      if (mutation && (session.sslPending || session.writes || context.canStart?.() === false)) return { ok: false, code: 'BUSY', message: 'Selesaikan operasi Nginx, editor, atau transfer sebelum mengelola SSL.' };
      if (mutation) session.sslPending = true;
      const readTicket=mutation?null:ticket(session,id,'ssl');
      const releaseHistory=mutation?reserveHistory(session,['ssl','sites','services']):()=>{};
      try {
        const data = await session.ssl.request(op, input, mutation?confirming(id,session,context,['ssl','sites','services']):context);
        if(mutation && sessions.get(id)===session) {
          // Successful Certbot results contain the final, re-read certificate list.
          const finalTicket=history?.begin(id,'ssl',session.historyKey);
          const saved=history?.save(finalTicket,data);
          return{ok:true,data,...(saved?{history:saved}:{})};
        }
        return success(session,id,data,readTicket);
      } catch (error) {
        if (sessions.get(id) !== session) return notConnected;
        if (error instanceof ToolError) return { ok: false, code: error.code, message: error.message, ...(error.partial ? { partial: true } : error.code === 'CANCELLED' ? { cancelled: true } : {}) };
        return failure(error);
      } finally { if (mutation) session.sslPending = false;releaseHistory(); }
    },

    /** Monitoring Prometheus: hanya 'load' (dengan rentang katalog) dan 'test'. */
    async monitor(id, op, range) {
      const valid = op === "test" || (op === "load" && typeof range === "string" && Object.hasOwn(RANGES, range));
      if (!valid) return { ok: false, code: "INVALID_REQUEST", message: "Permintaan tidak valid." };
      const s = sessions.get(id);
      if (!s?.monitor) return notConnected;
      try {
        return { ok: true, data: op === "load" ? await s.monitor.load(range) : await s.monitor.test() };
      } catch (e) {
        if (e instanceof PromError) return { ok: false, code: e.code, message: e.message };
        if (isConnectionLoss(e)) {
          close(id);
          return notConnected;
        }
        return failure(e);
      }
    },

    async call(id, op, ...args) {
      const validators = Object.hasOwn(OPS, op) ? OPS[op] : null;
      if (!validators || args.length < validators.length || !validators.every((check, i) => check(args[i]))) {
        return { ok: false, code: "INVALID_REQUEST", message: "Permintaan tidak valid." };
      }
      const s = sessions.get(id);
      if (!s) return notConnected;
      let release = () => {};
      let releaseHistory=()=>{};
      const readTicket=op==='list'?ticket(s,id,'sites'):null;
      try {
        if (!['list','read'].includes(op)) release = acquireWrite(id);
        if(!['list','read','test'].includes(op)){releaseHistory=reserveHistory(s,['sites','ssl']);history?.invalidate(id,['sites','ssl']);}
        return success(s,id,await s.ops[op](...args.slice(0, validators.length)),readTicket);
      } catch (e) {
        if (e instanceof NginxError || e instanceof ToolError) return { ok: false, code: e.code, message: e.message };
        if (isConnectionLoss(e)) {
          close(id);
          return notConnected;
        }
        return failure(e);
      } finally { release();releaseHistory(); }
    },
  };
}

module.exports = { createSessionManager, OPS };
