/**
 * service-worker.js — Cache do app shell do eCamp (PWA offline-first)
 *
 * Estratégia: cache-first. Na instalação, todos os arquivos do app shell são
 * guardados no cache; depois disso o app abre e funciona sem internet.
 * Quando a versão mudar (VERSAO_CACHE), o cache antigo é descartado.
 *
 * Todos os caminhos são RELATIVOS, para funcionar no GitHub Pages
 * (https://usuario.github.io/repositorio/) sem ajuste.
 */
const VERSAO_CACHE = 'ecamp-v0.3.1';

const ARQUIVOS_APP = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/storage.js',
  './js/esquemas.js',
  './js/dados-os-mock.js',
  './js/mapa-escopo.js',
  './js/equipamentos-mock.js',
  './js/romaneios.js',
  './js/campo-ruido.js',
  './js/fluxo.js',
  './js/app.js',
  './js/componentes/gps.js',
  './js/componentes/foto.js',
  './js/componentes/navegacao.js',
  './js/componentes/paginacao.js',
  './js/componentes/alerta-vento.js',
  './js/componentes/checagens.js',
  './js/componentes/canvas-sala.js',
  './public/logo-recortada.png',
  './public/icone-192.png',
  './public/icone-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO_CACHE)
      .then((cache) => cache.addAll(ARQUIVOS_APP))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes
          .filter((nome) => nome !== VERSAO_CACHE)
          .map((nome) => caches.delete(nome))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;

  evento.respondWith(
    caches.match(evento.request).then((emCache) => {
      if (emCache) return emCache;

      return fetch(evento.request)
        .then((resposta) => {
          // Guarda no cache só respostas válidas do próprio site
          const mesmaOrigem = evento.request.url.indexOf(self.location.origin) === 0;
          if (resposta && resposta.status === 200 && mesmaOrigem) {
            const copia = resposta.clone();
            caches.open(VERSAO_CACHE).then((cache) => cache.put(evento.request, copia));
          }
          return resposta;
        })
        .catch(() => {
          // Sem rede e sem cache: para navegação, devolve o app shell
          if (evento.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        });
    })
  );
});
