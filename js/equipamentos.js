/**
 * equipamentos.js — Equipamentos reais, vindos do SGP (Recursos → Equipamentos).
 *
 * Igual às OS: busca do SGP (GET /api/monitoramento/equipamentos), guarda uma
 * cópia local (localStorage) e funciona offline. Os equipamentos vêm agrupados
 * por variante (ruido, sismo, qarint, opacidade_ringelmann, opacidade_opacimetro),
 * com última/próxima calibração para o app bloquear os vencidos.
 *
 * QAR Externo (particulados): agora TAMBÉM vem do SGP (Amostrador de Grande Volume
 * + Separador Inercial). O mock EC.equipamentosMock.qar fica só como reserva offline.
 *
 * Interface (EC.equip):
 *   carregar(aoAtualizar) → devolve o cache já; busca o fresco e chama aoAtualizar.
 *   porVariante(chave)    → array de equipamentos daquela variante (SGP; ou o mock
 *                           EC.equipamentosMock como reserva no 1º uso sem internet).
 */
window.EC = window.EC || {};

EC.equip = (function () {
  'use strict';

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var ROTA_EQUIP = BASE + '/equipamentos';
  var TOKEN = '1488d0e2eece92e0796951cb693a4689c95cad0193e91ad2';
  var CH_LISTA = 'equip:lista';

  function mock(chave) {
    return (EC.equipamentosMock && EC.equipamentosMock[chave]) || null;
  }

  function porVariante(chave) {
    var cache = EC.storage.ler(CH_LISTA);
    if (cache && cache[chave] && cache[chave].length) return cache[chave];
    return mock(chave); // 1º uso sem internet: cai nos exemplos
  }

  async function atualizarDoServidor() {
    // Porta (x-ecamp-token) + identidade real (Authorization: Bearer <JWT>).
    // Offline/sem sessão manda só o token — o servidor tolera na Etapa 2.
    var headers = { 'x-ecamp-token': TOKEN };
    try {
      var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
      if (t) headers['Authorization'] = 'Bearer ' + t;
    } catch (e) { /* sem sessão/offline */ }
    var resp = await fetch(ROTA_EQUIP, { headers: headers });
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
