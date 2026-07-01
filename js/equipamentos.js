/**
 * equipamentos.js — Equipamentos reais, vindos do SGP (Recursos → Equipamentos).
 *
 * Igual às OS: busca do SGP (GET /api/monitoramento/equipamentos), guarda uma
 * cópia local (localStorage) e funciona offline. Os equipamentos vêm agrupados
 * por variante (ruido, sismo, qarint, opacidade_ringelmann, opacidade_opacimetro),
 * com última/próxima calibração para o app bloquear os vencidos.
 *
 * QAR Externo (particulados): os amostradores AGV NÃO estão no SGP — ficam fixos
 * no app (EC.equipamentosMock.qar). Por isso `porVariante('qar')` sempre usa o mock.
 *
 * Interface (EC.equip):
 *   carregar(aoAtualizar) → devolve o cache já; busca o fresco e chama aoAtualizar.
 *   porVariante(chave)    → array de equipamentos daquela variante (SGP ou, offline
 *                           / qar, o mock EC.equipamentosMock).
 */
window.EC = window.EC || {};

EC.equip = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var ROTA_EQUIP = BASE + '/equipamentos';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';
  var CH_LISTA = 'equip:lista';

  function mock(chave) {
    return (EC.equipamentosMock && EC.equipamentosMock[chave]) || null;
  }

  function porVariante(chave) {
    // QAR Externo fica sempre no app (amostradores AGV não estão no SGP).
    if (chave === 'qar') return mock('qar');
    var cache = EC.storage.ler(CH_LISTA);
    if (cache && cache[chave] && cache[chave].length) return cache[chave];
    return mock(chave); // 1º uso sem internet: cai nos exemplos
  }

  async function atualizarDoServidor() {
    var resp = await fetch(ROTA_EQUIP, { headers: { 'x-ecamp-token': TOKEN } });
    var corpo = await resp.json();
    if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resp.status));
    if (corpo.equipamentos) EC.storage.salvar(CH_LISTA, corpo.equipamentos);
    return corpo;
  }

  function carregar(aoAtualizar) {
    atualizarDoServidor().then(function () {
      if (typeof aoAtualizar === 'function') aoAtualizar();
    }).catch(function () { /* offline/erro: fica com o cache/mock */ });
  }

  return {
    carregar: carregar,
    porVariante: porVariante
  };
})();
