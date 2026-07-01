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
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  var CH_LISTA = 'os:lista';
  var CH_ANDAMENTO = 'os:andamento';
  var CH_RECENTES = 'os:recentes';
  var MAX_RECENTES = 10;

  function ler(chave, padrao) {
    var v = EC.storage.ler(chave);
    return v == null ? padrao : v;
  }

  function lista() {
    var l = ler(CH_LISTA, null);
    if (l && l.length) return l;
    return EC.osMock || []; // 1º uso sem internet: mostra os exemplos
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
  async function atualizarDoServidor() {
    var resp = await fetch(ROTA_OS, { headers: { 'x-ecamp-token': TOKEN } });
    var corpo = await resp.json();
    if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
    if (Array.isArray(corpo.os)) EC.storage.salvar(CH_LISTA, corpo.os);
    if (Array.isArray(corpo.andamento)) EC.storage.salvar(CH_ANDAMENTO, corpo.andamento);
    return corpo;
  }

  // Devolve o cache imediatamente e dispara a atualização em segundo plano.
  function carregar(aoAtualizar) {
    atualizarDoServidor().then(function () {
      if (typeof aoAtualizar === 'function') aoAtualizar(lista());
    }).catch(function () { /* offline/erro: fica com o cache */ });
    return lista();
  }

  return {
    carregar: carregar,
    lista: lista,
    andamento: andamento,
    recentes: recentes,
    marcarRecente: marcarRecente,
    esquecerRecente: esquecerRecente,
    buscar: buscar,
    osPorNumero: osPorNumero
  };
})();
