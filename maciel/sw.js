// Modo canteiro sem internet (Modelo 3D): guarda no aparelho a tela, os dados da obra e o modelo convertido.
// Só é registrado quando alguém aperta "Baixar para o canteiro" na tela do Modelo 3D.
// Dados (páginas, api.php, modelo3d.php): tenta a rede primeiro (até 6 s) e, sem sinal, usa a última cópia guardada.
// Programa (js, css) também é rede primeiro: com internet sempre roda a versão publicada; sem sinal, a cópia guardada.
// Arquivos fixos (wasm, imagens, fontes, modelo da demonstração): usa a cópia guardada e atualiza em segundo plano.
// Se a rede devolve a tela de login (sessão encerrada), apaga os dados guardados: nada da obra fica para outro usuário.
const DADOS = 'obras-canteiro-dados-v2';
const FIXOS = 'obras-canteiro-fixos-v2';
const BASE = new URL('./', self.registration.scope).pathname;
const NUNCA = /\/(sair|login|instalar|redefinir_senha)\.php$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil((async () => {
  const nomes = await caches.keys();
  await Promise.all(nomes.filter(n => n.startsWith('obras-canteiro-') && n !== DADOS && n !== FIXOS).map(n => caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('message', ev => {
  if (ev.data === 'limpar') ev.waitUntil(Promise.all([caches.delete(DADOS), caches.delete(FIXOS)]));
});

function fixo(u) {
  return /\.(wasm|png|jpe?g|svg|ico|woff2?|webmanifest)$/i.test(u.pathname) || u.pathname.startsWith(BASE + 'demo/');
}

async function daRede(req, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(req, { signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function redePrimeiro(req) {
  const cache = await caches.open(DADOS);
  try {
    const r = await daRede(req, 6000);
    if (r.redirected && /\/login\.php/.test(new URL(r.url).pathname)) {
      await caches.delete(DADOS);
      return r;
    }
    if (r.ok && r.status === 200) await cache.put(req, r.clone());
    return r;
  } catch (e) {
    const c = await cache.match(req);
    if (c) return c;
    throw e;
  }
}

async function guardadoPrimeiro(req, ev) {
  const cache = await caches.open(FIXOS);
  const c = await cache.match(req);
  const rede = fetch(req).then(r => { if (r.ok && r.status === 200) cache.put(req, r.clone()); return r; });
  if (c) { ev.waitUntil(rede.catch(() => null)); return c; }
  return rede;
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(BASE) || NUNCA.test(u.pathname)) return;
  if (u.searchParams.get('acao') === 'arquivo') return;   // IFC bruto: grande demais e não precisa no canteiro
  ev.respondWith(fixo(u) ? guardadoPrimeiro(req, ev) : redePrimeiro(req));
});
