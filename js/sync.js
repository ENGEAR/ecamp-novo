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
  var ROTA_PDF = BASE + '/pdf';
  var ROTA_DESCARTAR = BASE + '/descartar';
  var ROTA_RASCUNHO = BASE + '/rascunho';
  var BASE_BIBLIOTECA = 'https://engear-sgp.vercel.app/api/biblioteca';
  var TOKEN = 'f8b17592b0130d95047d37865a14b31570c6381509ccc066';

  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }
  // Atualiza a barra de pendências. Usa a função do app.js quando exposta; senão
  // (não está exposta em EC.app) atualiza a barra DIRETO — mesma lógica do app.js.
  // Sem isso, o sync nunca conseguia esconder um badge "N pendente(s)" preso.
  async function atualizarBarra() {
    if (EC.app && EC.app.atualizarBarraPendencias) { EC.app.atualizarBarraPendencias(); return; }
    try {
      var barra = document.getElementById('barra-pendencias');
      if (!barra) return;
      var temSessao = !!(EC.storage && EC.storage.ler && EC.storage.ler('sessao:atual'));
      if (!temSessao) { barra.classList.add('oculto'); return; }
      var n = 0;
      try { n = (await EC.db.keys('pending')).length; } catch (e) { /* ok */ }
      var semConexao = !navigator.onLine;
      var txt = document.getElementById('pendencias-texto');
      if (semConexao || n > 0) {
        var t = semConexao ? '📡 Sem conexão' : '';
        if (n > 0) t += (t ? ' · ' : '') + '⏳ ' + n + ' registro(s) pendente(s)';
        if (txt) txt.textContent = t;
        barra.classList.remove('oculto');
      } else {
        barra.classList.add('oculto');
      }
    } catch (e) { /* ok */ }
  }

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

  // Lista de pontos do registro na MESMA ordem global que o mapeador do servidor
  // usa (para casar com o `ordem` devolvido por /registro). No ruído interno e no
  // QAR Interno os pontos vivem em campo.ambientes[].pontos (achata ambiente a
  // ambiente, cada um limitado ao seu pontosCalculados — no QAR Interno soma +1
  // pelo ponto externo de referência, P1-Ext); na opacidade são os VEÍCULOS; nos
  // demais, é campo.pontos direto.
  function pontosDoRegistro(registro) {
    var campo = registro.campo || {};
    var sub = campo.subtipo || '';
    var ehRuidoInterno = (sub === 'interno10151' || sub === 'interno10152');
    var ehQarInterno = (registro.tipo === 'qarint');
    if (ehRuidoInterno || ehQarInterno) {
      var flat = [];
      (campo.ambientes || []).forEach(function (amb) {
        var pts = (amb && amb.pontos) || [];
        var calc = parseInt(amb && amb.pontosCalculados, 10);
        var limite = isNaN(calc) ? pts.length : Math.max(0, calc + (ehQarInterno ? 1 : 0));
        pts.slice(0, limite).forEach(function (p) { flat.push(p); });
      });
      return flat;
    }
    if (registro.tipo === 'opacidade') return campo.veiculos || [];
    return campo.pontos || [];
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

  // aoRegistrar (opcional): chamado assim que o SERVIDOR aceita os dados (antes
  // das fotos), com a resposta — traz `revisao`, usada no código do PDF.
  async function enviar(registro, aoRegistrar) {
    var resp = await postJson(ROTA_REGISTRO, semFotos(registro));
    if (typeof aoRegistrar === 'function') { try { aoRegistrar(resp); } catch (e) { /* ok */ } }
    var pontos = resp.pontos || []; // [{ordem, janela, ponto_id, revisao}, ...]
    var pontosCampo = pontosDoRegistro(registro);

    // Monta a lista de fotos a enviar. O servidor devolve uma entrada por
    // (ponto × janela); para cada uma, pego as fotos da janela correspondente
    // (estrutura nova: pc.total/pc.residual; antiga: o próprio ponto, flat).
    var tarefas = [];
    pontos.forEach(function (pr) {
      var pc = pontosCampo[(pr.ordem || 1) - 1];
      if (!pc) return;
      var alvo = (pr.janela && pc[pr.janela] && typeof pc[pr.janela] === 'object') ? pc[pr.janela] : pc;
      fotosDoPonto(alvo).forEach(function (f) {
        tarefas.push({ ponto_id: pr.ponto_id, tipo: f.tipo, nomeArquivo: f.nomeArquivo, base64: f.base64 });
      });
    });

    // Interno: sobe o LAYOUT de cada ambiente, ligado ao 1º ponto (Total) do
    // ambiente — a numeração de pontos é global, então a base acumula.
    var sub = (registro.campo && registro.campo.subtipo) || '';
    if (sub === 'interno10151' || sub === 'interno10152') {
      var mapaPid = {};
      pontos.forEach(function (pr) { mapaPid[(pr.ordem || 1) + '|' + (pr.janela || 'total')] = pr.ponto_id; });
      var ordemBase = 0;
      ((registro.campo && registro.campo.ambientes) || []).forEach(function (amb) {
        var calc = parseInt(amb && amb.pontosCalculados, 10);
        var n = isNaN(calc) ? ((amb && amb.pontos) || []).length : Math.max(0, calc);
        var pid = mapaPid[(ordemBase + 1) + '|total'];
        var lf = amb && amb.layoutFoto;
        if (pid && lf && lf.base64 && lf.nomeArquivo) {
          tarefas.push({ ponto_id: pid, tipo: 'layout_ambiente', nomeArquivo: lf.nomeArquivo, base64: lf.base64 });
        }
        ordemBase += n;
      });
    }

    // envia em lotes paralelos (mais rápido em monitoramentos grandes)
    for (var k = 0; k < tarefas.length; k += FOTOS_EM_PARALELO) {
      var lote = tarefas.slice(k, k + FOTOS_EM_PARALELO);
      await Promise.all(lote.map(function (t) { return postJson(ROTA_FOTO, t); }));
    }
    return resp;
  }

  // Sobe o PDF gerado para o SharePoint (pasta "PDFs Campo"), como corpo BINÁRIO
  // (não base64 → cabe mais no limite da Vercel). Best-effort: o PDF já está
  // salvo no aparelho, então falha aqui não perde nada. Devolve true/false.
  async function enviarPdf(nome, blob) {
    if (!blob) return false;
    try {
      var resposta = await fetch(ROTA_PDF + '?nome=' + encodeURIComponent(nome || 'Relatorio.pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'x-ecamp-token': TOKEN },
        body: blob
      });
      var corpo = {};
      try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
      return !!(resposta.ok && corpo.ok);
    } catch (e) {
      return false;
    }
  }

  // Chave estável do rascunho na fila (por OS+serviço). DETERMINÍSTICA: re-salvar
  // o mesmo rascunho sobrescreve a mesma entrada (não acumula na fila).
  function chaveRascPendente(registro) {
    return 'rasc:' + (registro.rascunhoId || registro.codificacao);
  }

  // Sincroniza UM registro (chamado logo após salvar). Em falha de rede, enfileira.
  // aoRegistrar: chamado com a resposta do servidor (traz `revisao`) ou com null
  // quando o envio falhou (offline) — quem espera a revisão não fica travado.
  async function sincronizarRegistro(registro, aoRegistrar) {
    // Finalizar SUPERA qualquer rascunho na fila do mesmo serviço: remove-o para
    // um rascunho atrasado não reenviar "Incompleto" DEPOIS do finalizado.
    if (registro.rascunhoId) { try { await EC.db.remove('pending', chaveRascPendente(registro)); } catch (e) { /* ok */ } }
    var avisado = false;
    try {
      await enviar(registro, function (resp) {
        avisado = true;
        if (typeof aoRegistrar === 'function') { try { aoRegistrar(resp); } catch (e) { /* ok */ } }
      });
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
      if (!avisado && typeof aoRegistrar === 'function') { try { aoRegistrar(null); } catch (e2) { /* ok */ } }
    }
    atualizarBarra();
  }

  // Salva o rascunho no servidor (status Incompleto). Reusa o envio em 2 etapas
  // (dados + fotos). Em falha de REDE, enfileira (igual ao finalizado) para subir
  // sozinho quando a conexão voltar — o dado do campo NÃO fica preso no aparelho.
  async function sincronizarRascunho(registro) {
    var chave = chaveRascPendente(registro);
    try {
      await enviar(registro); // registro vem com finalizar:false + rascunhoId
      try { await EC.db.remove('pending', chave); } catch (e) { /* ok */ }
      toast('✅ Rascunho salvo no servidor (Incompleto).');
    } catch (e) {
      if (e.naoSuportado) {
        // 422: faltam dados mínimos p/ o servidor aceitar — só o aparelho por ora.
        toast('💾 Rascunho salvo no aparelho (ainda faltam dados para o servidor).');
      } else {
        // Offline/erro de rede: guarda na fila (IndexedDB aguenta as fotos) e
        // reenvia sozinho no próximo "online". Chave estável = sobrescreve.
        try { await EC.db.set('pending', chave, registro); } catch (e2) { /* ok */ }
        toast('📤 Rascunho salvo — sincroniza sozinho quando a conexão voltar.');
      }
    }
    atualizarBarra();
  }

  /* ===== Rascunho colaborativo (continuar serviço de outro técnico) ===== */

  // Busca no servidor o rascunho de um serviço (dados SEM fotos) + estado da
  // trava. Devolve { rascunho: {rascunhoId, estado, tecnico, atualizadoEm}|null,
  // lock: {tecnico,email,expiraEm,expirada}|null }. Lança erro se offline/falha.
  async function buscarRascunho(os, escopo, servico) {
    var q = '?os=' + encodeURIComponent(os) +
      '&escopo=' + encodeURIComponent(escopo || '') +
      '&servico=' + encodeURIComponent(servico || '');
    var resposta = await fetch(ROTA_RASCUNHO + q, { headers: { 'x-ecamp-token': TOKEN } });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return { rascunho: corpo.rascunho || null, lock: corpo.lock || null };
  }

  // Lista os rascunhos da equipe para uma OS (leve, sem os snapshots) — usado na
  // tela de serviços para marcar quais a equipe já começou e por quem. Devolve
  // [{ rascunhoId, servicoId, escopo, tecnico, atualizadoEm }]. Erro se offline.
  async function listarRascunhos(os) {
    var resposta = await fetch(ROTA_RASCUNHO + '?lista=1&os=' + encodeURIComponent(os), { headers: { 'x-ecamp-token': TOKEN } });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo.rascunhos || [];
  }

  // Ações da trava de edição. acao: 'lock' | 'refresh' | 'unlock'. Best-effort no
  // unlock/refresh; no lock devolve o corpo ({travada} ou {bloqueada, por}).
  async function travaRascunho(acao, os, servico, forcar) {
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    try {
      return await postJson(ROTA_RASCUNHO, {
        acao: acao, os: os, servico: servico,
        tecnico: sessao.nome || '', email: sessao.email || '', forcar: !!forcar
      });
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  }
  function travar(os, servico, forcar) { return travaRascunho('lock', os, servico, forcar); }
  function renovarTrava(os, servico) { return travaRascunho('refresh', os, servico); }
  function liberarTrava(os, servico) { return travaRascunho('unlock', os, servico); }

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
    // Fila vazia: atualiza a barra ANTES de sair — senão um badge "N pendente(s)"
    // que ficou preso (corrida ao voltar online) não some ao tocar em Sincronizar.
    if (!chaves.length) { atualizarBarra(); if (!silencioso) toast('Nada pendente para sincronizar.'); return; }
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

  /* ===== Biblioteca (normas/procedimentos gerenciados pelo SGP) ===== */

  // Lista de documentos ativos (só metadados). Lança erro se offline/falhar.
  async function buscarBiblioteca() {
    var resposta = await fetch(BASE_BIBLIOTECA + '/lista', {
      headers: { 'x-ecamp-token': TOKEN }
    });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo.documentos || [];
  }

  // Bytes do PDF de um documento → Blob. Lança erro se offline/falhar.
  async function baixarDocumentoBiblioteca(id) {
    var resposta = await fetch(BASE_BIBLIOTECA + '/arquivo?id=' + encodeURIComponent(id), {
      headers: { 'x-ecamp-token': TOKEN }
    });
    if (!resposta.ok) {
      var corpo = {};
      try { corpo = await resposta.json(); } catch (e) { /* não era JSON */ }
      throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    }
    return resposta.blob();
  }

  return {
    enviar: enviar,
    enviarPdf: enviarPdf,
    sincronizarRegistro: sincronizarRegistro,
    sincronizarRascunho: sincronizarRascunho,
    descartarRascunho: descartarRascunho,
    buscarRascunho: buscarRascunho,
    listarRascunhos: listarRascunhos,
    travar: travar,
    renovarTrava: renovarTrava,
    liberarTrava: liberarTrava,
    sincronizarPendentes: sincronizarPendentes,
    buscarBiblioteca: buscarBiblioteca,
    baixarDocumentoBiblioteca: baixarDocumentoBiblioteca
  };
})();
