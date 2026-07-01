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

  var BASE = 'https://engear-sgp.vercel.app/api/monitoramento';
  var ROTA_REGISTRO = BASE + '/registro';
  var ROTA_FOTO = BASE + '/foto';
  var ROTA_DESCARTAR = BASE + '/descartar';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  function atualizarBarra() { if (EC.app && EC.app.atualizarBarraPendencias) EC.app.atualizarBarraPendencias(); }

  // POST JSON com o token. Lança erro em falha (err.naoSuportado=true se 422).
  async function postJson(url, dados) {
    var resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ecamp-token': TOKEN },
      body: JSON.stringify(dados)
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

  // Cópia do registro SEM o base64/dataUrl das fotos (envio leve dos dados).
  function semFotos(obj) {
    return JSON.parse(JSON.stringify(obj, function (k, v) {
      return (k === 'base64' || k === 'dataUrl') ? undefined : v;
    }));
  }

  // Coleta as fotos de um ponto: qualquer campo que seja array (ou objeto) com base64.
  function fotosDoPonto(ponto) {
    var out = [];
    if (!ponto) return out;
    Object.keys(ponto).forEach(function (k) {
      var v = ponto[k];
      var lista = Array.isArray(v) ? v : (v && v.base64 ? [v] : []);
      lista.forEach(function (f) {
        if (f && f.base64 && f.nomeArquivo) out.push({ tipo: k, nomeArquivo: f.nomeArquivo, base64: f.base64 });
      });
    });
    return out;
  }

  // Envia o registro em duas etapas (evita o limite de tamanho da Vercel):
  //   1) os DADOS (leves, sem fotos) → /registro; o servidor devolve os pontos;
  //   2) cada FOTO separada → /foto (uma de cada vez).
  // Idempotente: reenviar devolve o mapeamento dos pontos e as fotos repetidas
  // são ignoradas no servidor. Lança erro em falha (err.naoSuportado=true se 422).
  var FOTOS_EM_PARALELO = 4; // quantas fotos sobem ao mesmo tempo

  async function enviar(registro) {
    var resp = await postJson(ROTA_REGISTRO, semFotos(registro));
    var pontos = resp.pontos || [];
    var pontosCampo = (registro.campo && registro.campo.pontos) || [];

    // monta a lista de todas as fotos a enviar (com o ponto de destino)
    var tarefas = [];
    for (var i = 0; i < pontos.length; i++) {
      var pid = pontos[i].ponto_id;
      var fotos = fotosDoPonto(pontosCampo[i]);
      for (var j = 0; j < fotos.length; j++) {
        tarefas.push({ ponto_id: pid, tipo: fotos[j].tipo, nomeArquivo: fotos[j].nomeArquivo, base64: fotos[j].base64 });
      }
    }

    // envia em lotes paralelos (mais rápido em monitoramentos grandes)
    for (var k = 0; k < tarefas.length; k += FOTOS_EM_PARALELO) {
      var lote = tarefas.slice(k, k + FOTOS_EM_PARALELO);
      await Promise.all(lote.map(function (t) { return postJson(ROTA_FOTO, t); }));
    }
    return resp;
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

  // Salva o rascunho no servidor (status Incompleto). Reusa o envio em 2 etapas
  // (dados + fotos). Best-effort: se faltar dado/internet, fica só no aparelho.
  async function sincronizarRascunho(registro) {
    try {
      await enviar(registro); // registro vem com finalizar:false + rascunhoId
      toast('✅ Rascunho salvo no servidor (Incompleto).');
    } catch (e) {
      if (e.naoSuportado) {
        toast('💾 Rascunho salvo no aparelho (ainda faltam dados para o servidor).');
      } else {
        toast('💾 Rascunho salvo no aparelho (sem internet para o servidor agora).');
      }
    }
    atualizarBarra();
  }

  // Descarta o rascunho no servidor (quando a OS foi aberta por engano). Apaga o
  // monitoramento Incompleto pelo rascunhoId — some da lista compartilhada e da
  // planilha. Best-effort: se não houver internet, o descarte local já basta e
  // o registro do servidor (se existir) cai depois, quando alguém reabrir.
  async function descartarRascunho(rascunhoId) {
    if (!rascunhoId) return;
    try {
      await postJson(ROTA_DESCARTAR, { rascunhoId: rascunhoId });
    } catch (e) {
      // sem internet/erro: o descarte local já aconteceu; não trava o técnico
    }
  }

  // Reenvia toda a fila pendente. silencioso=true não avisa quando não há nada.
  async function sincronizarPendentes(silencioso) {
    // Itera pelas CHAVES (mesma fonte do contador da barra) e lê uma a uma —
    // assim entradas ilegíveis/presas são detectadas e limpas (auto-cura).
    var chaves = [];
    try { chaves = await EC.db.keys('pending'); } catch (e) { /* ok */ }
    if (!chaves.length) { if (!silencioso) toast('Nada pendente para sincronizar.'); return; }
    var ok = 0, pendente = 0, limpos = 0;
    for (var i = 0; i < chaves.length; i++) {
      var chave = chaves[i];
      var reg = null;
      try { reg = await EC.db.get('pending', chave); } catch (e) { reg = null; }
      if (!reg || !reg.codificacao || !reg.campo) {
        // entrada inválida/ilegível → remove (fantasma travado)
        try { await EC.db.remove('pending', chave); limpos++; } catch (e) { /* ok */ }
        continue;
      }
      try {
        await enviar(reg); // servidor é idempotente: reenvio devolve "ok"
        try { await EC.db.remove('pending', chave); } catch (e) { /* ok */ }
        ok++;
      } catch (e) {
        if (e.naoSuportado) { try { await EC.db.remove('pending', chave); } catch (e2) { /* ok */ } }
        else { pendente++; }
      }
    }
    if (!silencioso || ok || limpos) {
      toast('Sincronização: ' + ok + ' enviado(s)' +
        (pendente ? ', ' + pendente + ' pendente(s)' : '') +
        (limpos ? ', ' + limpos + ' limpo(s)' : '') + '.');
    }
    atualizarBarra();
  }

  // Limpeza única: remove restos antigos da fila no localStorage (versões < 0.15
  // guardavam 'pending:' lá; agora a fila vive no IndexedDB).
  try {
    EC.storage.listar('pending:').forEach(function (it) { EC.storage.remover(it.chave); });
  } catch (e) { /* ok */ }

  // Quando a conexão volta, tenta reenviar a fila em silêncio (e auto-limpa fantasmas).
  window.addEventListener('online', function () { sincronizarPendentes(true); });

  return {
    enviar: enviar,
    sincronizarRegistro: sincronizarRegistro,
    sincronizarRascunho: sincronizarRascunho,
    descartarRascunho: descartarRascunho,
    sincronizarPendentes: sincronizarPendentes
  };
})();
