/**
 * os.js — Lista de OS reais, vinda do SGP (menu Propostas → Ordem de Serviço).
 *
 * O app busca as OS de uma rota do SGP (GET /api/monitoramento/os) e guarda uma
 * CÓPIA local (localStorage). Assim a tela inicial abre na hora com o que já foi
 * baixado e funciona offline; quando há internet, atualiza em segundo plano.
 *
 * Três formas de achar a OS na tela inicial:
 *   • Buscar     → digita número/cliente e filtra a lista toda.
 *   • Em andamento → OS que já começaram o serviço no servidor (status
 *                    Incompleto). Vem do servidor, então aparece para TODA a
 *                    equipe (começou no laboratório, continua no campo).
 *   • Recentes   → as últimas ~10 que ESTE aparelho abriu (atalho pessoal).
 *
 * Enquanto não há nada baixado (1º uso offline), cai no EC.osMock (exemplos).
 *
 * Interface (EC.os):
 *   carregar(aoAtualizar) → devolve a lista em cache já; busca a fresca e chama
 *                           aoAtualizar(lista) quando ela chega.
 *   lista()               → array de OS (cache ou, se vazio, EC.osMock).
 *   andamento()           → array de números de OS em andamento (do servidor).
 *   recentes()            → array de números das últimas OS abertas neste aparelho.
 *   marcarRecente(numero) → registra uma OS como recente (topo, sem repetir, máx 10).
 *   buscar(termo)         → filtra lista() por número/cliente/resumo.
 */
window.EC = window.EC || {};

EC.os = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var ROTA_OS = BASE + '/os';
  var ROTA_FOTOS = BASE + '/os-fotos';
  var ROTA_DESCARTAR_OS = BASE + '/descartar-os';   // legado (DELETE) — não usar mais
  var ROTA_ARQUIVAR_OS = BASE + '/arquivar-os';     // soft: arquiva sem apagar
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  var CH_LISTA = 'os:lista';
  var CH_ANDAMENTO = 'os:andamento';
  var CH_RECENTES = 'os:recentes';
  var CH_SESSAO_EXPIRADA = 'os:sessaoExpirada';
  var CH_CARREGADO = 'os:carregado'; // já baixou a lista real do servidor ao menos 1x
  var MAX_RECENTES = 10;

  function ler(chave, padrao) {
    var v = EC.storage.ler(chave);
    return v == null ? padrao : v;
  }

  // Já baixou a lista real do servidor (mesmo que tenha voltado com 0 OS)?
  function jaCarregou() { return !!ler(CH_CARREGADO, false); }

  function lista() {
    var l = ler(CH_LISTA, null);
    // Se o servidor JÁ respondeu (mesmo com 0 OS), a lista real é a verdade —
    // nunca mostrar os exemplos (senão o técnico sem OS na agenda vê OS falsas).
    if (jaCarregou()) return Array.isArray(l) ? l : [];
    if (l && l.length) return l;
    return EC.osMock || []; // só no 1º uso, antes de baixar do servidor
  }

  function andamento() { return ler(CH_ANDAMENTO, []) || []; }

  function recentes() { return ler(CH_RECENTES, []) || []; }

  function marcarRecente(numero) {
    if (!numero) return;
    var atual = recentes().filter(function (n) { return n !== numero; });
    atual.unshift(numero);
    EC.storage.salvar(CH_RECENTES, atual.slice(0, MAX_RECENTES));
  }

  // Tira uma OS dos "recentes" (ex.: ao descartar um serviço aberto por engano).
  function esquecerRecente(numero) {
    EC.storage.salvar(CH_RECENTES, recentes().filter(function (n) { return n !== numero; }));
  }

  // Normaliza para busca: minúsculas, sem acento.
  function normalizar(t) {
    return (t || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function buscar(termo) {
    var t = normalizar(termo).trim();
    var todas = lista();
    if (!t) return todas;
    return todas.filter(function (os) {
      var alvo = normalizar(os.numero + ' ' + os.cliente + ' ' + (os.resumo || ''));
      return alvo.indexOf(t) !== -1;
    });
  }

  function osPorNumero(numero) {
    var todas = lista();
    for (var i = 0; i < todas.length; i++) {
      if (todas[i].numero === numero) return todas[i];
    }
    return null;
  }

  // Busca a lista fresca no servidor e atualiza o cache. Best-effort (offline: ignora).
  // Devolve um access_token VÁLIDO para mandar ao servidor. O getSession pode
  // devolver um token JÁ VENCIDO (o app fica dias sem primeiro plano e o
  // auto-refresh do supabase-js não chegou a rodar) — então, se estiver perto de
  // vencer ou já vencido, renovamos na hora. Assim o técnico não precisa deslogar.
  async function tokenValido(cli) {
    var s = await cli.auth.getSession();
    var sess = s && s.data && s.data.session;
    if (!sess) return '';
    var agora = Math.floor(Date.now() / 1000);
    var venceEm = sess.expires_at || 0;
    if (!venceEm || (venceEm - agora) < 90) {
      try {
        var r = await cli.auth.refreshSession();
        if (r && r.data && r.data.session) sess = r.data.session;
      } catch (e) { /* offline/refresh falhou: usa o token atual mesmo */ }
    }
    return (sess && sess.access_token) || '';
  }

  function sessaoExpirada() { return !!EC.storage.ler(CH_SESSAO_EXPIRADA); }

  // Manda o token da sessão (Authorization) para o servidor filtrar as OS do usuário
  // (bloqueio da Etapa 3: técnico só recebe as OS dele).
  //
  // ROBUSTEZ (2026-07-21): antes o app confiava no token do getSession (podia
  // estar vencido) e, se o servidor respondesse "sem sessão", SOBRESCREVIA a
  // lista com vazio — o técnico perdia todas as OS e precisava deslogar/logar.
  // Agora: (1) renova o token antes de enviar; (2) se ainda vier "sem sessão",
  // tenta renovar UMA vez e refazer; (3) se mesmo assim não houver sessão, NUNCA
  // apaga a lista local — mantém as OS que o técnico já tinha e marca o estado.
  async function atualizarDoServidor() {
    var cli = EC.auth && EC.auth.cliente ? EC.auth.cliente() : null;

    async function buscar(token) {
      var headers = { 'x-ecamp-token': TOKEN };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var resp = await fetch(ROTA_OS, { headers: headers });
      var corpo = await resp.json();
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      return corpo;
    }

    var token = '';
    try { if (cli) token = await tokenValido(cli); } catch (e) { token = ''; }

    var corpo = await buscar(token);

    // Servidor não reconheceu a sessão: força uma renovação e tenta de novo.
    if (corpo.semSessao && cli) {
      var novo = '';
      try {
        var r = await cli.auth.refreshSession();
        novo = (r && r.data && r.data.session && r.data.session.access_token) || '';
      } catch (e) { novo = ''; }
      if (novo) { try { corpo = await buscar(novo); } catch (e) { /* mantém corpo anterior */ } }
    }

    if (corpo.semSessao) {
      // Sessão realmente expirada (refresh token morto). NÃO zera a lista: mantém
      // o cache e sinaliza que precisa reautenticar (a tela avisa, sem perder OS).
      EC.storage.salvar(CH_SESSAO_EXPIRADA, true);
      return { ok: true, os: lista(), andamento: andamento(), semSessao: true };
    }

    EC.storage.remover(CH_SESSAO_EXPIRADA);
    if (Array.isArray(corpo.os)) {
      EC.storage.salvar(CH_LISTA, corpo.os);
      EC.storage.salvar(CH_CARREGADO, true); // marca que a lista real (mesmo vazia) já veio
    }
    if (Array.isArray(corpo.andamento)) EC.storage.salvar(CH_ANDAMENTO, corpo.andamento);
    return corpo;
  }

  /* ======================================================================
   * Escopo de OS por usuário (quem vê o quê na tela de Serviços)
   *
   * Regra: quem tem papel "logistica" (ou "admin") no SGP vê TODAS as OS. Os
   * demais só veem as OS em que estão escalados na Agenda. O vínculo é:
   *   e-mail do login → tecnicos.email → nome do técnico → agendamentos.tecnicos[]
   *   → ordem_servico_id, que casa com o os.osId da lista (UUID × UUID).
   *
   * É um filtro de TELA (app-only), não uma barreira de servidor: as OS já
   * chegam todas ao aparelho (token compartilhado). O escopo é cacheado por
   * e-mail para continuar valendo offline.
   * ==================================================================== */
  var CH_ESCOPO = 'os:escopo';

  function sessaoLogada() { return EC.storage.ler('sessao:atual') || {}; }
  function ehLogistica(papeis) {
    papeis = papeis || [];
    return papeis.indexOf('logistica') !== -1 || papeis.indexOf('admin') !== -1;
  }

  // FILTRO DE OS POR AGENDA DESLIGADO (2026-07-14): estava barrando técnicos
  // (ex.: Edgar) de ver OS em que estavam escalados — o vínculo
  // e-mail→técnico→agenda não é confiável o bastante. Com isto false, TODOS
  // veem TODAS as OS. Para religar a restrição, volte para true.
  var RESTRINGIR_POR_AGENDA = false;

  // Padrão "libera tudo" até o cálculo terminar, para não esconder OS por uma
  // fração de segundo (logística é o uso mais comum). calculado=false sinaliza
  // que ainda não confirmamos com o servidor.
  var escopo = { tudo: true, osIds: [], calculado: false, incerto: false };

  function escopoAtual() { return escopo; }

  function dentroEscopo(os) {
    if (!RESTRINGIR_POR_AGENDA || escopo.tudo) return true;
    return !!(os && os.osId && escopo.osIds.indexOf(os.osId) !== -1);
  }

  // Ajusta o escopo em memória a partir do cache, se for do mesmo usuário —
  // usado no 1º pintar da tela para o usuário restrito já ver as SUAS OS na hora.
  function prepararEscopoDoCache() {
    if (!RESTRINGIR_POR_AGENDA) { escopo = { tudo: true, osIds: [], calculado: true, incerto: false }; return escopo; }
    var email = (sessaoLogada().email || '').trim().toLowerCase();
    var c = EC.storage.ler(CH_ESCOPO);
    if (c && (c.email || '') === email) {
      escopo = { tudo: !!c.tudo, osIds: c.osIds || [], calculado: false, incerto: true };
    } else {
      escopo = { tudo: true, osIds: [], calculado: false, incerto: true };
    }
    return escopo;
  }

  // Calcula (e cacheia) o escopo do usuário logado. Best-effort: em caso de
  // falha (offline/erro), mantém o último escopo salvo do mesmo usuário.
  async function carregarEscopo() {
    if (!RESTRINGIR_POR_AGENDA) { escopo = { tudo: true, osIds: [], calculado: true, incerto: false }; return escopo; }
    var s = sessaoLogada();
    var email = (s.email || '').trim().toLowerCase();
    var papeis = s.papeis || [];
    // Login offline pode não ter trazido os papéis — tenta de novo.
    if ((!papeis || !papeis.length) && EC.auth && EC.auth.meusPapeis) {
      try { papeis = await EC.auth.meusPapeis(); } catch (e) { /* mantém */ }
    }
    if (ehLogistica(papeis)) {
      escopo = { tudo: true, osIds: [], calculado: true, incerto: false };
      EC.storage.salvar(CH_ESCOPO, { em: new Date().toISOString(), tudo: true, osIds: [], email: email });
      return escopo;
    }
    var cli = EC.auth && EC.auth.cliente ? EC.auth.cliente() : null;
    try {
      if (!cli || !email) throw new Error('sem cliente/email');
      // e-mail do login → nome(s) do técnico (case-insensitive)
      var tq = await cli.from('tecnicos').select('nome').ilike('email', email);
      var nomes = (tq.data || []).map(function (t) { return (t.nome || '').trim(); }).filter(Boolean);
      if (!nomes.length) {
        escopo = { tudo: false, osIds: [], calculado: true, incerto: false };
      } else {
        var nomesLc = nomes.map(function (n) { return n.toLowerCase(); });
        // Agendamentos onde este técnico está escalado. O vínculo com a OS vem
        // por ordem_servico_id OU só por proposta_id (agenda criada a partir da
        // proposta, antes de a OS ser ligada) — cobrimos os DOIS casos, senão a
        // OS escalada por proposta some da lista de Serviços do técnico.
        var aq = await cli.from('agendamentos').select('ordem_servico_id, proposta_id, tecnicos');
        var ids = {};        // osIds diretos (ordem_servico_id)
        var propostas = {};  // proposta_ids a resolver -> osId
        (aq.data || []).forEach(function (a) {
          var meu = (a.tecnicos || []).some(function (t) {
            return nomesLc.indexOf((t.nome || '').trim().toLowerCase()) !== -1;
          });
          if (!meu) return;
          if (a.ordem_servico_id) ids[a.ordem_servico_id] = 1;
          else if (a.proposta_id) propostas[a.proposta_id] = 1;
        });
        // Resolve as propostas escaladas para o osId da OS correspondente.
        var listaPropostas = Object.keys(propostas);
        if (listaPropostas.length) {
          try {
            var oq = await cli.from('ordens_servico').select('id').in('proposta_id', listaPropostas);
            (oq.data || []).forEach(function (o) { if (o && o.id) ids[o.id] = 1; });
          } catch (e) { /* sem internet/erro: fica só com os vínculos diretos */ }
        }
        escopo = { tudo: false, osIds: Object.keys(ids), calculado: true, incerto: false };
      }
      EC.storage.salvar(CH_ESCOPO, { em: new Date().toISOString(), tudo: escopo.tudo, osIds: escopo.osIds, email: email });
      return escopo;
    } catch (e) {
      var cache = EC.storage.ler(CH_ESCOPO);
      if (cache && (cache.email || '') === email) {
        escopo = { tudo: !!cache.tudo, osIds: cache.osIds || [], calculado: true, incerto: true };
      } else {
        escopo = { tudo: false, osIds: [], calculado: true, incerto: true };
      }
      return escopo;
    }
  }

  /* ======================================================================
   * "Em andamento por quem" — quem está preenchendo cada OS
   *
   * Lê os monitoramentos com status 'rascunho' direto do Supabase (RLS libera
   * leitura para qualquer logado) e monta um mapa nº da OS → nomes dos técnicos.
   * Assim o cartão mostra "Em andamento · Fulano", inclusive de rascunhos que
   * estão sendo preenchidos em OUTRO aparelho da equipe. Cacheia para offline.
   * ==================================================================== */
  var CH_AND_POR = 'os:andamentoPor';
  var andamentoPorMapa = ler(CH_AND_POR, {}) || {};

  // Normaliza o nº da OS para casar as fontes (tira o prefixo "OS ").
  function normNum(n) { return String(n == null ? '' : n).replace(/^\s*OS\s+/i, '').trim(); }

  // Nomes dos técnicos que estão com a OS em andamento (rascunho no servidor).
  function andamentoPor(numero) { return andamentoPorMapa[normNum(numero)] || []; }

  // Ao DESCARTAR um serviço, tira a OS de "em andamento" na hora (sem esperar o
  // servidor): remove do mapa da tag (os:andamentoPor) E da lista da seção
  // (os:andamento). Offline-safe; o re-sync do servidor depois reconcilia (se
  // outro técnico ainda estiver com ela, volta a aparecer).
  function esquecerAndamento(numero) {
    var n = normNum(numero);
    if (andamentoPorMapa[n]) { delete andamentoPorMapa[n]; EC.storage.salvar(CH_AND_POR, andamentoPorMapa); }
    var lista = ler(CH_ANDAMENTO, []) || [];
    var filtrada = lista.filter(function (x) { return normNum(x) !== n; });
    if (filtrada.length !== lista.length) EC.storage.salvar(CH_ANDAMENTO, filtrada);
  }

  // Logística/admin: ARQUIVA (não apaga) TODOS os rascunhos presos de uma OS no
  // servidor (quando o técnico desistiu e a OS ficou travada em "em andamento").
  // Nada é apagado: os monitoramentos vão para o SGP → Obsoletos → Rascunhos de
  // campo (de onde dá para restaurar). Depois tira a OS de "em andamento"
  // localmente (seção + tag). Requer internet.
  async function limparAndamentoOS(numero) {
    var n = normNum(numero);
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    var resp = await fetch(ROTA_ARQUIVAR_OS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN },
      body: JSON.stringify({ os: n, tecnico: sessao.nome || '' })
    });
    var corpo = await resp.json();
    if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
    esquecerAndamento(n);
    return corpo;
  }

  async function carregarAndamentoPor() {
    var cli = EC.auth && EC.auth.cliente ? EC.auth.cliente() : null;
    if (!cli) return andamentoPorMapa;
    try {
      var q = await cli.from('monitoramentos')
        .select('os, tecnico, updated_at')
        .eq('status', 'rascunho')
        .order('updated_at', { ascending: false });
      var mapa = {};
      (q.data || []).forEach(function (r) {
        var num = normNum(r.os);
        var nome = (r.tecnico || '').trim();
        if (!num || !nome) return;
        if (!mapa[num]) mapa[num] = [];
        if (mapa[num].indexOf(nome) === -1) mapa[num].push(nome); // já em ordem de recência
      });
      andamentoPorMapa = mapa;
      EC.storage.salvar(CH_AND_POR, mapa);
      return mapa;
    } catch (e) {
      return andamentoPorMapa; // offline/erro: mantém o cache
    }
  }

  /* ======================================================================
   * Detalhes completos da OS (ordens_servico.detalhes) — para a tela de
   * "Dados gerais do serviço" mostrar TUDO da OS (descrição, campanhas,
   * metodologia, informações relevantes, origem/destino, local).
   *
   * O endpoint /api/monitoramento/os manda só um resumo; aqui a gente lê o
   * jsonb `detalhes` direto do Supabase pela sessão do usuário (RLS de
   * ordens_servico libera leitura a qualquer logado). App-only, cacheado por
   * OS para abrir na hora e funcionar offline. (Fotos NÃO vêm aqui: o bucket
   * é privado ao comercial — ficam para uma etapa com o servidor.)
   * ==================================================================== */
  var CH_DET = 'os:detalhes:';

  function detalhesCache(osId) { return osId ? ler(CH_DET + osId, null) : null; }

  async function carregarDetalhes(osId) {
    if (!osId) return null;
    var cli = EC.auth && EC.auth.cliente ? EC.auth.cliente() : null;
    if (!cli) return detalhesCache(osId);
    try {
      var q = await cli.from('ordens_servico').select('detalhes').eq('id', osId).single();
      var det = (q && q.data && q.data.detalhes) ? q.data.detalhes : null;
      if (det) EC.storage.salvar(CH_DET + osId, det);
      return det || detalhesCache(osId);
    } catch (e) {
      return detalhesCache(osId); // offline/erro: usa o que já baixou
    }
  }

  // Fotos da OS (Análise Crítica): URLs assinadas, geradas pelo servidor (o
  // bucket é privado ao comercial). Online-only; offline devolve [] e a tela
  // avisa para conectar. Não cacheia (as URLs assinadas expiram em ~1h).
  async function carregarFotos(osId) {
    if (!osId) return [];
    try {
      var resp = await fetch(ROTA_FOTOS + '?osId=' + encodeURIComponent(osId), { headers: { 'x-ecamp-token': TOKEN } });
      var corpo = await resp.json();
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
      return Array.isArray(corpo.fotos) ? corpo.fotos : [];
    } catch (e) {
      return []; // offline/erro: sem fotos (o resto da OS segue offline)
    }
  }

  // Devolve o cache imediatamente e dispara a atualização em segundo plano.
  // O callback recebe (lista, info) — info.semSessao avisa a tela que a sessão
  // expirou (para pedir novo login) SEM que a lista tenha sido apagada.
  function carregar(aoAtualizar) {
    atualizarDoServidor().then(function (corpo) {
      if (typeof aoAtualizar === 'function') aoAtualizar(lista(), { semSessao: !!(corpo && corpo.semSessao) });
    }).catch(function () { /* offline/erro: fica com o cache */ });
    return lista();
  }

  return {
    carregar: carregar,
    lista: lista,
    sessaoExpirada: sessaoExpirada,
    jaCarregou: jaCarregou,
    andamento: andamento,
    recentes: recentes,
    marcarRecente: marcarRecente,
    esquecerRecente: esquecerRecente,
    buscar: buscar,
    osPorNumero: osPorNumero,
    carregarEscopo: carregarEscopo,
    prepararEscopoDoCache: prepararEscopoDoCache,
    escopoAtual: escopoAtual,
    dentroEscopo: dentroEscopo,
    carregarAndamentoPor: carregarAndamentoPor,
    andamentoPor: andamentoPor,
    esquecerAndamento: esquecerAndamento,
    limparAndamentoOS: limparAndamentoOS,
    carregarDetalhes: carregarDetalhes,
    detalhesCache: detalhesCache,
    carregarFotos: carregarFotos
  };
})();
