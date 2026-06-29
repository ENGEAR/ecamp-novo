/**
 * sync.js — Sincronização do registro com o servidor (SGP → Supabase + SharePoint).
 *
 * O e-CAMP NÃO fala com o banco direto: ele manda o registro para uma rota do
 * SGP, que grava com segurança no servidor (a chave secreta fica lá, nunca aqui).
 * O TOKEN abaixo é um portão básico (o app é público) — a proteção forte virá
 * com o login por e-mail. Se offline, o registro fica na fila 'pending:' e é
 * reenviado quando a conexão volta ou ao tocar em "Sincronizar".
 */
window.EC = window.EC || {};

EC.sync = (function () {
  'use strict';

  var ROTA = 'https://engear-sgp.vercel.app/api/monitoramento/registro';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function atualizarBarra() { if (EC.app && EC.app.atualizarBarraPendencias) EC.app.atualizarBarraPendencias(); }

  // Envia um registro ao servidor. Lança erro em falha (err.naoSuportado=true se 422).
  async function enviar(registro) {
    var resposta = await fetch(ROTA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN },
      body: JSON.stringify(registro)
    });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) {
      var err = new Error(corpo.erro || ('HTTP ' + resposta.status));
      err.naoSuportado = (resposta.status === 422);
      throw err;
    }
    return corpo;
  }

  // Sincroniza UM registro (chamado logo após salvar). Em falha de rede, enfileira.
  async function sincronizarRegistro(registro) {
    try {
      await enviar(registro);
      try { await EC.db.remove('pending', registro.codificacao); } catch (e) { /* ok */ }
      toast('✅ Enviado ao servidor.');
    } catch (e) {
      if (e.naoSuportado) {
        toast('ℹ️ Este tipo ainda não sincroniza com o servidor. Salvo no aparelho.');
      } else {
        // Offline/erro: guarda na fila (IndexedDB aguenta as fotos) p/ enviar depois.
        try { await EC.db.set('pending', registro.codificacao, registro); } catch (e2) { /* ok */ }
        toast('📴 Sem conexão. Guardado para sincronizar depois.');
      }
    }
    atualizarBarra();
  }

  // Reenvia toda a fila pendente. silencioso=true não avisa quando não há nada.
  async function sincronizarPendentes(silencioso) {
    var registros = [];
    try { registros = await EC.db.getAll('pending'); } catch (e) { /* ok */ }
    if (!registros.length) { if (!silencioso) toast('Nada pendente para sincronizar.'); return; }
    var ok = 0, pendente = 0;
    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];
      try {
        await enviar(r);
        try { await EC.db.remove('pending', r.codificacao); } catch (e) { /* ok */ }
        ok++;
      } catch (e) {
        if (e.naoSuportado) { try { await EC.db.remove('pending', r.codificacao); } catch (e2) { /* ok */ } }
        else { pendente++; }
      }
    }
    if (!silencioso || ok) {
      toast('Sincronização: ' + ok + ' enviado(s)' + (pendente ? ', ' + pendente + ' ainda pendente(s)' : '') + '.');
    }
    atualizarBarra();
  }

  // Quando a conexão volta, tenta reenviar a fila em silêncio.
  window.addEventListener('online', function () { sincronizarPendentes(true); });

  return {
    enviar: enviar,
    sincronizarRegistro: sincronizarRegistro,
    sincronizarPendentes: sincronizarPendentes
  };
})();
