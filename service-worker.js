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
const VERSAO_CACHE = 'ecamp-v0.58.6';

const ARQUIVOS_APP = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/storage.js',
  './js/vendor/supabase.js',
  './js/auth.js',
  './js/db.js',
  './js/sync.js',
  './js/esquemas.js',
  './js/dados-os-mock.js',
  './js/os.js',
  './js/mapa-escopo.js',
  './js/equipamentos-mock.js',
  './js/equipamentos.js',
  './js/vendor/jspdf.umd.min.js',
  './js/pdf-ruido.js',
  './js/romaneios.js',
  './js/campo-ruido.js',
  './js/campo-vibracao.js',
  './js/campo-qar.js',
  './js/campo-opacidade.js',
  './js/campo-qarint.js',
  './js/campo-outro.js',
  './js/fluxo.js',
  './js/reembolso.js',
  './js/aprovacoes.js',
  './js/agenda.js',
  './js/biblioteca.js',
  './js/app.js',
  './js/componentes/gps.js',
  './js/componentes/foto.js',
  './js/componentes/navegacao.js',
  './js/componentes/paginacao.js',
  './js/componentes/alerta-vento.js',
  './js/componentes/checagens.js',
  './js/componentes/canvas-sala.js',
  './public/logo-recortada.png',
  './public/engear-logo.png',
  './public/icone-192.png',
  './public/icone-512.png',
  './public/Ru%C3%ADdo.jpeg',
  './public/Vibra%C3%A7%C3%A3o.jpeg',
  './public/QAR%20Externo.jpeg',
  './public/opacidade.jpeg',
  './public/QAR%20Interno.jpeg',
  './public/Outro.png',
  './public/Ambiente%20Externo.png',
  './public/Ambiente%20Interno%20(NBR%2010151).png',
  './public/Ambiente%20Interno%20(NBR%2010152).png'
];

// Os PDFs da Biblioteca NÃO passam mais por aqui: a lista vem da API do SGP e
// cada PDF baixado fica no IndexedDB (js/biblioteca.js) — offline sem pré-cache.

self.addEventListener('install', (evento) => {
  // NÃO chama skipWaiting: a versão nova fica "em espera". O app mostra o aviso
  // "nova versão disponível" e só assume quando o usuário toca em Atualizar
  // (evita recarregar sozinho no meio de uma medição em campo).
  evento.waitUntil(
    caches.open(VERSAO_CACHE).then((cache) =>
      // App shell: obrigatório (addAll falha tudo se um item faltar).
      cache.addAll(ARQUIVOS_APP)
    )
  );
});

// Quando o usuário toca em Atualizar, a página manda SKIP_WAITING e o SW novo
// assume o controle (clients.claim no activate dispara o reload da página).
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.type === 'SKIP_WAITING') self.skipWaiting();
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
