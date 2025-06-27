import https from "node:https";
import http from "node:http";
import { fileURLToPath, URLPattern } from "node:url";
import { readFile } from "node:fs/promises";

const SORTED = Symbol("sorted");
const urlVar = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
const vhostSpecificity = (pattern) => pattern === 'default' ? 0
  : pattern.split('.').map(a => a.indexOf('*') !== -1 ? 1 : 10).reduce((s, v) => s + v, 0);
const urlSpecificity = (pattern) => pattern === 'default' ? 0
  : pattern.split('/').map(a => urlVar.test(a) ? 1 : 10).reduce((s, v) => s + v, 0);
const desc = (comp) => (a, b) => comp(b, a);
const byCalculated = (calculator) => (a, b) => calculator(a) - calculator(b);
const select = (selector) => (comp) => (a, b) => comp(selector(a), selector(b));
const selectFirstOfArray = select(([a]) => a);
const byVhostPattern = selectFirstOfArray(desc(byCalculated(vhostSpecificity)));
const byUrlPattern = selectFirstOfArray(desc(byCalculated(urlSpecificity)));

const matcherFromVhostPattern = (pattern) => pattern === 'default' ? /^.*$/
  : new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '([^\\.]+)')}$`);

const escHtml = (v) => v.replace(/[<>"&]/g, (m) => ({"<":"&lt;",">":"&gt;","\"":"&quot;","&":"&amp;"}[m]));

const processVhosts = (vhosts) => {
  if (!vhosts[SORTED]) {
    const r = [];
    for (const [pattern, conf] of Object.entries(vhosts).sort(byVhostPattern)) {
      r.push({ pattern: matcherFromVhostPattern(pattern), ...conf });
    }
    vhosts[SORTED] = r;
  }
  return vhosts[SORTED];
};

const matcherFromPathPattern = (pattern, vhost = 'localhost') => {
  const pat = new URLPattern({ pathname: pattern });
  const baseUrl = `http://${vhost}/`;
  return {
    test: (path) => pat.test(path, baseUrl),
    exec: (path) => pat.exec(path, baseUrl)?.pathname?.groups,
  };
}

const processRules = (rules = []) => {
  if (!rules[SORTED]) {
    const r = [];
    for (const [pattern, mapping] of Object.entries(rules).sort(byUrlPattern)) {
      r.push({ pattern: matcherFromPathPattern(pattern), mapping });
    }
    rules[SORTED] = r;
  }
  return rules[SORTED];
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const normalizeContent = async (refOrContent) => {
  if (refOrContent instanceof Buffer) return refOrContent;
  if (refOrContent instanceof URL) return readFile(fileURLToPath(refOrContent));
  if (typeof refOrContent === 'string') return Buffer.from(refOrContent, 'utf8');
  return Buffer.from(refOrContent);
};

const processSslOptions = async ({ key, cert }) => {
  key = await normalizeContent(key);
  cert = await normalizeContent(cert);
  return { key, cert };
};

const remapPath = ({ rules }, path) => {
  for (const { pattern, mapping } of processRules(rules)) {
    if (!pattern.test(path)) continue;
    const matches = pattern.exec(path);
    if (typeof mapping === 'string') {
      return mapping.split('/').map((part) => part.replace(urlVar, (_, key) => matches[key] ? encodeURIComponent(matches[key]) : _)).join('/');
    } else if (typeof mapping === 'function') {
      return (req, res) => {
        req.matches = matches;
        return mapping(req, res);
      }
    }
  }
  return path;
};

export const createProxy = async ({
  vhosts,
  port: listenPort,
  bind,
  debug,
  filters: {
    pre = () => {},
    post = () => {},
  } = {},
  ssl,
} = {}) => {
  const findVhost = (vhost) => processVhosts(vhosts).find(({ pattern }) => pattern.test(vhost));
  const proxyRequest = async (req, res) => {
    const orig_vhost = (req.headers.host ?? '').toLowerCase();
    const vhost = orig_vhost.replace(/:\d+$/, '');
    req.vhost = vhost;
    if (debug) {
      console.log(`Request for ${vhost}${req.url} from ${req.connection.remoteAddress}`);
    }
    if (pre(req, res)) {
      return;
    }
    const vhostConf = findVhost(vhost);
    if (!vhostConf || !vhostConf.host || !vhostConf.port) {
      throw new HttpError(500, `No virtual host matches <code>${escHtml(vhost)}</code>; a virtual host must have at least a <code>host</code> and <code>port</code>.`);
    }
    const mapped = remapPath(vhostConf, req.url);
    if (typeof mapped === 'string') {
      req.url = mapped;
    } else if (typeof mapped === 'function') {
      if (mapped(req, res)) return;
    }
    const { host, port, secure } = vhostConf;
    const { resolve, reject, promise } = Promise.withResolvers();
    
    const client = (secure ? https : http);
    const proxyHeaders = {
      ...req.headers,
      'X-forwarded-for': req.connection.remoteAddress,
    }
    
    const proxyReq = client.request({
      host,
      port,
      method: req.method, 
      path: req.url,
      headers: proxyHeaders,
    });
    proxyReq.addListener('error', (e) => {
      console.log(`Request for //${vhost}${req.url} failed - back-end server ${secure ? 'https' : 'http'}://${host}:${port}${req.url} caused exception : ${e}`);
      reject(new HttpError(503, 'An error was encountered talking to the back-end server.'));
    });
    proxyReq.addListener('response', (proxyResp) => {
      if (proxyResp.headers.connection) {
        proxyResp.headers.connection = req.headers.connection ?? 'close'
      }
      post(proxyResp, req, vhost);
      res.writeHead(proxyResp.statusCode, proxyResp.headers);
      if (proxyResp.statusCode === 304) {
        res.end();
        resolve();
        return;
      }
      proxyResp.addListener('data', (chunk) => res.write(chunk, 'binary'));
      proxyResp.addListener('end', () => {
        res.end();
        resolve();
      });
    });
    req.addListener('data', (chunk) => proxyReq.write(chunk, 'binary'));
    req.addListener('end', () => proxyReq.end());
    return promise;
  };

  process.on('uncaughtException', (e) => {
    console.warn(`ERROR: ${e}`);
    console.warn(e.stack);
  });

  const handleRequest = async (req, res) => {
    try {
      return await proxyRequest(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        res.writeHead(e.status ?? 500, { 'content-type': 'text/html' });
        res.end(e.message ?? "An unknown error occurred");
      } else {
        res.writeHead(e.status ?? 500, { 'content-type': 'text/plain' });
        res.end(e.stack ?? "An unknown error occurred");
      }
    }
  };
  const server = ssl ? https.createServer(await processSslOptions(ssl)) : http.createServer();
  server.addListener('request', handleRequest);
  server.listen(listenPort, bind);
  return server;
};
