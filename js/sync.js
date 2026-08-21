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
  var ROTA_DESCARTAR = BASE + '/descartar';        // legado (DELETE) — não usar
  var ROTA_ARQUIVAR_RASCUNHO = BASE + '/arquivar-rascunho'; // soft: preserva o antigo
  var ROTA_RASCUNHO = BASE + '/rascunho';
  var BASE_BIBLIOTECA = 'https://engear-sgp.vercel.app/api/biblioteca';
  var TOKEN = '1488d0e2eece92e0796951cb693a4689c95cad0193e91ad2';

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

  // Monta os cabeçalhos das chamadas ao SGP: a "porta" (x-ecamp-token) + a
  // IDENTIDADE real do usuário (Authorization: Bearer <JWT da sessão>). O
  // servidor confia no JWT, não no nome guardado no aparelho. Sem sessão/offline
  // vai só o token — o servidor tolera enquanto os apps não atualizam (Etapa 2).
  async function cabecalhos(extra) {
    var h = Object.assign({ 'x-ecamp-token': TOKEN }, extra || {});
    try {
      var t = (EC.auth && EC.auth.tokenValido) ? await EC.auth.tokenValido() : '';
      if (t) h['Authorization'] = 'Bearer ' + t;
    } catch (e) { /* sem sessão/offline: manda só o token */ }
    return h;
  }

  // Tempo limite de cada requisição. Sem isto, um envio pendurado (sinal que
  // cai no meio, rede que não responde) deixava a fila esperando PARA SEMPRE —
  // sem erro, sem aviso e sem enviar mais nada (caso do Erick, OS 26255).
  var LIMITE_MS = 45000;
  function comLimite(ms) {
    if (typeof AbortController === 'undefined') return { signal: undefined, pronto: function () {} };
    var ac = new AbortController();
    var t = setTimeout(function () { ac.abort(); }, ms || LIMITE_MS);
    return { signal: ac.signal, pronto: function () { clearTimeout(t); } };
  }

  // POST JSON com o token. Lança erro em falha (err.naoSuportado=true se 422).
  async function postJson(url, dados, opcoes) {
    var corpoTxt = JSON.stringify(dados);
    // `keepalive` deixa a requisição sobreviver ao fechamento da página (usado
    // no envio ao SAIR do app). O limite do navegador é ~64 KB — acima disso a
    // requisição seria recusada, então só liga quando cabe.
    var manterVivo = !!(opcoes && opcoes.aoSair) && corpoTxt.length < 60000;
    var limite = comLimite();
    var resposta;
    try {
      resposta = await fetch(url, {
        method: 'POST',
        headers: await cabecalhos({ 'Content-Type': 'application/json' }),
        body: corpoTxt,
        keepalive: manterVivo,
        signal: limite.signal
      });
    } finally { limite.pronto(); }
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) {
      var err = new Error(corpo.erro || ('HTTP ' + resposta.status));
      err.naoSuportado = (resposta.status === 422);
      throw err;
    }
    return corpo;
  }

  // Cópia para a FILA: sem as imagens (elas estão na loja 'fotos' do aparelho),
  // senão cada item da fila voltaria a ser um registro gigante.
  async function leve(registro) {
    if (!(EC.foto && EC.foto.semImagens)) return semFotos(registro);
    try {
      var r = await EC.foto.garantirGuardadas(registro, { os: registro.os && registro.os.numero });
      if (r.falhas) return registro;   // sem cópia na loja: guarda inteiro
    } catch (e) { return registro; }
    return EC.foto.semImagens(registro);
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

  // Fotos que estão no registro só como NOME, sem a imagem: o aparelho perdeu o
  // conteúdo (o rascunho grande não coube no banco local, por exemplo). Não há o
  // que enviar — e dizer "enviado" esconde o problema (caso da OS 26255).
  function fotosSemImagem(ponto) {
    var n = 0;
    if (!ponto) return 0;
    Object.keys(ponto).forEach(function (k) {
      var v = ponto[k];
      var lista = Array.isArray(v) ? v : (v && (v.nomeArquivo || v.base64) ? [v] : []);
      lista.forEach(function (f) { if (f && f.nomeArquivo && !f.base64) n++; });
    });
    return n;
  }

  // Envia o registro em duas etapas (evita o limite de tamanho da Vercel):
  //   1) os DADOS (leves, sem fotos) → /registro; o servidor devolve os pontos;
  //   2) cada FOTO separada → /foto (uma de cada vez).
  // Idempotente: reenviar devolve o mapeamento dos pontos e as fotos repetidas
  // são ignoradas no servidor. Lança erro em falha (err.naoSuportado=true se 422).
  var FOTOS_EM_PARALELO = 4; // quantas fotos sobem ao mesmo tempo
  var TENTATIVAS_FOTO = 3;   // tentativas por foto antes de deixar para depois
  // Nomes das fotos que JÁ chegaram ao servidor. Fica no localStorage (e não no
  // IndexedDB) de propósito: criar uma loja nova exigiria subir a versão do
  // banco no aparelho de quem está com fotos na fila, e não vale o risco.
  var CHAVE_FOTOS_ENVIADAS = 'fotos:enviadas';
  var MAX_FOTOS_LEMBRADAS = 3000;   // ~200 KB; acima disso descarta as mais antigas
  var fotosEnviadas = null;         // Set em memória, carregado uma vez

  // aoRegistrar (opcional): chamado assim que o SERVIDOR aceita os dados (antes
  // das fotos), com a resposta — traz `revisao`, usada no código do PDF.
  async function enviar(registro, aoRegistrar) {
    var resp = await postJson(ROTA_REGISTRO, semFotos(registro));
    if (typeof aoRegistrar === 'function') { try { aoRegistrar(resp); } catch (e) { /* ok */ } }
    var pontos = resp.pontos || []; // [{ordem, periodo, janela, ponto_id, revisao}, ...]
    var pontosCampo = pontosDoRegistro(registro);

    // Monta a lista de fotos a enviar. O servidor devolve uma entrada por
    // (ponto × período × janela); para cada uma, pego as fotos da janela daquele
    // período (estrutura nova: pc.periodos[periodo].total/.residual; antiga:
    // pc.total/pc.residual ou o próprio ponto flat).
    var tarefas = [];
    var semImagem = 0;   // fotos que o registro tem só pelo nome
    pontos.forEach(function (pr) {
      var pc = pontosCampo[(pr.ordem || 1) - 1];
      if (!pc) return;
      var med = (pc.periodos && pr.periodo && pc.periodos[pr.periodo]) ? pc.periodos[pr.periodo] : pc;
      var alvo = (pr.janela && med[pr.janela] && typeof med[pr.janela] === 'object') ? med[pr.janela] : med;
      fotosDoPonto(alvo).forEach(function (f) {
        tarefas.push({ ponto_id: pr.ponto_id, tipo: f.tipo, nomeArquivo: f.nomeArquivo, base64: f.base64 });
      });
      semImagem += fotosSemImagem(alvo);
    });

    // Interno: sobe o LAYOUT de cada ambiente, ligado ao 1º ponto (Total) do
    // ambiente — a numeração de pontos é global, então a base acumula.
    var sub = (registro.campo && registro.campo.subtipo) || '';
    if (sub === 'interno10151' || sub === 'interno10152') {
      var mapaPid = {};
      // O layout do ambiente liga ao 1º ponto (Total). Com períodos há várias
      // linhas Total por ordem — fica com a PRIMEIRA (qualquer serve p/ o layout).
      pontos.forEach(function (pr) { var key = (pr.ordem || 1) + '|' + (pr.janela || 'total'); if (mapaPid[key] === undefined) mapaPid[key] = pr.ponto_id; });
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

    resp.fotos = await subirFotos(tarefas);
    resp.fotos.semImagem = semImagem;
    return resp;
  }

  /**
   * Sobe as fotos, uma a uma, TOLERANDO falha.
   *
   * Antes as fotos iam em lotes de 4 com Promise.all: bastava UMA falhar para o
   * lote inteiro estourar, o envio ser abortado e todas as fotos seguintes
   * ficarem para trás — sem ninguém saber. Foi o que aconteceu na OS 26255, em
   * que 164 de 242 fotos nunca saíram do aparelho (2026-08-20).
   *
   * Agora cada foto tem a sua própria chance (com retentativa) e uma que não
   * sobe não impede as outras. As que subiram ficam marcadas no aparelho, para
   * a próxima tentativa mandar só o que falta — em sinal de campo, reenviar
   * centenas de fotos era justamente o que fazia o envio morrer.
   *
   * Devolve { total, enviadas, jaEstavam, falharam: [nomes] }.
   */
  async function subirFotos(tarefas) {
    var res = { total: tarefas.length, enviadas: 0, jaEstavam: 0, falharam: [] };
    // Enquanto sobe, a barra do topo mostra o andamento: o técnico precisa saber
    // que ESTÁ indo e que sair do app interrompe (o iPhone congela o app ao
    // trocar de aplicativo — foi o que cortou o envio no meio, OS 26255).
    var feitas = 0;
    function passo() {
      feitas++;
      if (EC.app && EC.app.mostrarProgressoEnvio) {
        EC.app.mostrarProgressoEnvio(feitas, tarefas.length);
      }
    }
    for (var k = 0; k < tarefas.length; k += FOTOS_EM_PARALELO) {
      var lote = tarefas.slice(k, k + FOTOS_EM_PARALELO);
      await Promise.all(lote.map(async function (t) {
        if (fotoJaEnviada(t.nomeArquivo)) { res.jaEstavam++; passo(); return; }
        for (var tentativa = 1; tentativa <= TENTATIVAS_FOTO; tentativa++) {
          try {
            await postJson(ROTA_FOTO, t);
            marcarFotoEnviada(t.nomeArquivo);
            res.enviadas++;
            passo();
            return;
          } catch (e) {
            // 422 (o servidor não aceita esta foto) não melhora tentando de novo.
            if (e && e.naoSuportado) break;
            if (tentativa < TENTATIVAS_FOTO) await esperar(700 * tentativa);
          }
        }
        res.falharam.push(t.nomeArquivo);
        passo();
      }));
      gravarFotosEnviadas();   // a cada lote: um fechamento do app não perde a marca
    }
    if (EC.app && EC.app.mostrarProgressoEnvio) EC.app.mostrarProgressoEnvio(0, 0); // limpa
    return res;
  }

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Fotos que JÁ chegaram ao servidor, por nome de arquivo (único por foto).
  // Se a leitura falhar, o pior caso é reenviar — nunca deixar de enviar.
  function carregarFotosEnviadas() {
    if (fotosEnviadas) return fotosEnviadas;
    var lista = [];
    try { lista = EC.storage.ler(CHAVE_FOTOS_ENVIADAS) || []; } catch (e) { lista = []; }
    fotosEnviadas = new Set(Array.isArray(lista) ? lista : []);
    return fotosEnviadas;
  }
  function gravarFotosEnviadas() {
    try {
      var lista = Array.from(carregarFotosEnviadas());
      if (lista.length > MAX_FOTOS_LEMBRADAS) {
        lista = lista.slice(lista.length - MAX_FOTOS_LEMBRADAS);
        fotosEnviadas = new Set(lista);
      }
      EC.storage.salvar(CHAVE_FOTOS_ENVIADAS, lista);
    } catch (e) { /* sem espaço: no máximo reenvia depois */ }
  }
  function fotoJaEnviada(nome) { return carregarFotosEnviadas().has(nome); }
  function marcarFotoEnviada(nome) { carregarFotosEnviadas().add(nome); }

  // Sobe o PDF gerado para o SharePoint (pasta "PDFs Campo"), como corpo BINÁRIO
  // (não base64 → cabe mais no limite da Vercel). Best-effort: o PDF já está
  // salvo no aparelho, então falha aqui não perde nada. Devolve true/false.
  async function enviarPdf(nome, blob) {
    if (!blob) return false;
    var limite = comLimite(60000);
    try {
      var resposta = await fetch(ROTA_PDF + '?nome=' + encodeURIComponent(nome || 'Relatorio.pdf'), {
        method: 'POST',
        headers: await cabecalhos({ 'Content-Type': 'application/pdf' }),
        body: blob,
        signal: limite.signal
      });
      var corpo = {};
      try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
      return !!(resposta.ok && corpo.ok);
    } catch (e) {
      return false;
    } finally { limite.pronto(); }
  }

  /**
   * PDFs que ficaram no aparelho sem chegar ao SharePoint. O envio do PDF é
   * best-effort no momento em que ele é gerado — se o app for para segundo
   * plano bem nessa hora (é o que acontece quando se compartilha no WhatsApp),
   * ele se perde em silêncio. Aqui a fila tenta de novo, e só marca quando o
   * servidor confirma. Devolve quantos subiram.
   */
  async function reenviarPdfsPendentes() {
    if (!EC.db || !EC.db.disponivel()) return 0;
    var lista = [];
    try { lista = (await EC.db.getAll('pdfs')) || []; } catch (e) { return 0; }
    var n = 0;
    // Só os RECENTES: um aparelho com histórico cheio não vai remandar dezenas
    // de PDFs antigos (que já estão no servidor) na primeira sincronização.
    var limite = Date.now() - 3 * 24 * 60 * 60 * 1000;
    for (var i = 0; i < lista.length; i++) {
      var rec = lista[i];
      if (!rec || !rec.blob || rec.enviadoEm) continue;
      var quando = Date.parse(rec.salvoEm || '');
      if (quando && quando < limite) continue;
      var ok = await enviarPdf(rec.nome, rec.blob);
      if (ok) {
        n++;
        rec.enviadoEm = new Date().toISOString();
        try { await EC.db.set('pdfs', rec.id, rec); } catch (e) { /* ok */ }
      }
    }
    return n;
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
      var r = await enviar(registro, function (resp) {
        avisado = true;
        if (typeof aoRegistrar === 'function') { try { aoRegistrar(resp); } catch (e) { /* ok */ } }
      });
      // Fotos que não subiram: o registro CONTINUA na fila e a pessoa é avisada
      // (antes o envio era abortado na 1ª falha e ninguém ficava sabendo).
      var faltam = (r && r.fotos && r.fotos.falharam.length) || 0;
      var sem = (r && r.fotos && r.fotos.semImagem) || 0;
      if (!faltam && sem) {
        try { await EC.db.remove('pending', registro.codificacao); } catch (e2) { /* ok */ }
        toast('⚠️ Dados enviados, mas ' + sem + ' foto(s) não estão mais no aparelho (só o nome do arquivo) — não há o que enviar.');
      } else if (faltam) {
        try { await EC.db.set('pending', registro.codificacao, await leve(registro)); } catch (e2) { /* ok */ }
        toast('⚠️ Dados enviados, mas ' + faltam + ' foto(s) não subiram. Elas seguem no aparelho — toque em Sincronizar com boa conexão.');
      } else {
        try { await EC.db.remove('pending', registro.codificacao); } catch (e) { /* ok */ }
        toast('✅ Enviado ao servidor.');
      }
    } catch (e) {
      if (e.naoSuportado) {
        toast('ℹ️ Este tipo ainda não sincroniza com o servidor. Salvo no aparelho.');
      } else {
        // Offline/erro: guarda na fila (IndexedDB aguenta as fotos) p/ enviar depois.
        try { await EC.db.set('pending', registro.codificacao, await leve(registro)); } catch (e2) { /* ok */ }
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
      var r = await enviar(registro); // registro vem com finalizar:false + rascunhoId
      // Fotos que não subiram: mantém na fila e AVISA. Antes o envio parava na
      // 1ª falha e o técnico via "sincroniza sozinho" achando que estava tudo lá.
      var faltam = (r && r.fotos && r.fotos.falharam.length) || 0;
      var sem = (r && r.fotos && r.fotos.semImagem) || 0;
      if (!faltam && sem) {
        try { await EC.db.remove('pending', chave); } catch (e2) { /* ok */ }
        toast('⚠️ Rascunho salvo, mas ' + sem + ' foto(s) não estão mais no aparelho (só o nome do arquivo).');
      } else if (faltam) {
        try { await EC.db.set('pending', chave, await leve(registro)); } catch (e2) { /* ok */ }
        toast('⚠️ Rascunho salvo, mas ' + faltam + ' foto(s) não subiram. Elas seguem no aparelho — toque em Sincronizar com boa conexão.');
      } else {
        try { await EC.db.remove('pending', chave); } catch (e) { /* ok */ }
        toast('✅ Rascunho salvo no servidor (Incompleto).');
      }
    } catch (e) {
      if (e.naoSuportado) {
        // 422: faltam dados mínimos p/ o servidor aceitar — só o aparelho por ora.
        toast('💾 Rascunho salvo no aparelho (ainda faltam dados para o servidor).');
      } else {
        // Offline/erro de rede: guarda na fila (IndexedDB aguenta as fotos) e
        // reenvia sozinho no próximo "online". Chave estável = sobrescreve.
        try { await EC.db.set('pending', chave, await leve(registro)); } catch (e2) { /* ok */ }
        toast('📤 Rascunho salvo — sincroniza sozinho quando a conexão voltar.');
      }
    }
    atualizarBarra();
  }

  // Auto-push LEVE do rascunho: só os DADOS (sem fotos), a cada avanço de tela.
  // Mantém o SharePoint atualizado com o que já foi preenchido, SEM depender do
  // botão "Salvar rascunho" e SEM torrar a internet do campo (as fotos sobem no
  // "Salvar rascunho"/Finalizar). Silencioso. Falha de rede enfileira o rascunho
  // COMPLETO (com fotos) na mesma chave estável → o auto-retry do online garante
  // a entrega (inclusive das fotos) mesmo em sinal ruim.
  async function sincronizarRascunhoDados(registro, opcoes) {
    try {
      await postJson(ROTA_REGISTRO, semFotos(registro), opcoes); // leve: só os dados
    } catch (e) {
      if (!e.naoSuportado) {
        try { await EC.db.set('pending', chaveRascPendente(registro), registro); } catch (e2) { /* ok */ }
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
    var resposta = await fetch(ROTA_RASCUNHO + q, { headers: await cabecalhos() });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return { rascunho: corpo.rascunho || null, lock: corpo.lock || null };
  }

  // Lista os rascunhos da equipe para uma OS (leve, sem os snapshots) — usado na
  // tela de serviços para marcar quais a equipe já começou e por quem. Devolve
  // [{ rascunhoId, servicoId, escopo, tecnico, atualizadoEm }]. Erro se offline.
  async function listarRascunhos(os) {
    var resposta = await fetch(ROTA_RASCUNHO + '?lista=1&os=' + encodeURIComponent(os), { headers: await cabecalhos() });
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

  // ARQUIVA (soft, nunca apaga) o rascunho antigo pelo rascunhoId — usado no
  // "Reiniciar": a versão antiga vai para o SGP → Obsoletos → Rascunhos de campo
  // e o servidor destaca o rascunho_id, para o rascunho novo não sobrescrevê-la.
  // Best-effort: sem internet, não trava o técnico (o novo segue localmente).
  async function arquivarRascunho(rascunhoId) {
    if (!rascunhoId) return;
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    try {
      await postJson(ROTA_ARQUIVAR_RASCUNHO, { rascunhoId: rascunhoId, tecnico: sessao.nome || '' });
    } catch (e) {
      /* sem internet/erro: melhor que apagar — o antigo continua no servidor */
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
    var ok = 0, pendente = 0, limpos = 0, fotosPendentes = 0;
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
        // A fila guarda só as referências: as imagens vêm da loja 'fotos'.
        if (EC.foto && EC.foto.reidratar) { try { await EC.foto.reidratar(reg); } catch (e2) { /* segue */ } }
        var r = await enviar(reg); // servidor é idempotente: reenvio devolve "ok"
        // Sobrou foto? O registro FICA na fila (a próxima tentativa manda só o
        // que falta, porque as enviadas ficam marcadas no aparelho).
        var faltam = (r && r.fotos && r.fotos.falharam.length) || 0;
        if (faltam) { fotosPendentes += faltam; pendente++; }
        else {
          try { await EC.db.remove('pending', chave); } catch (e) { /* ok */ }
          ok++;
        }
      } catch (e) {
        if (e.naoSuportado) { try { await EC.db.remove('pending', chave); } catch (e2) { /* ok */ } }
        else { pendente++; }
      }
    }
    var pdfsOk = await reenviarPdfsPendentes();
    if (!silencioso || ok || limpos || fotosPendentes || pdfsOk) {
      toast('Sincronização: ' + ok + ' enviado(s)' +
        (pdfsOk ? ', ' + pdfsOk + ' PDF(s)' : '') +
        (pendente ? ', ' + pendente + ' pendente(s)' : '') +
        (fotosPendentes ? ' (' + fotosPendentes + ' foto(s) ainda no aparelho)' : '') +
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
  // E quando o app VOLTA para a frente: o iPhone congela o app ao trocar de
  // aplicativo (compartilhar no WhatsApp) ou ao bloquear a tela, e o envio para
  // no meio sem avisar. Ao voltar, a fila recomeça sozinha de onde parou — as
  // fotos que já subiram ficam marcadas, então só sobe o que falta.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.onLine) sincronizarPendentes(true);
  });

  /* ===== Biblioteca (normas/procedimentos gerenciados pelo SGP) ===== */

  // Lista de documentos ativos (só metadados). Lança erro se offline/falhar.
  async function buscarBiblioteca() {
    var resposta = await fetch(BASE_BIBLIOTECA + '/lista', {
      headers: await cabecalhos()
    });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* corpo vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo.documentos || [];
  }

  // Bytes do PDF de um documento → Blob. Lança erro se offline/falhar.
  async function baixarDocumentoBiblioteca(id) {
    var resposta = await fetch(BASE_BIBLIOTECA + '/arquivo?id=' + encodeURIComponent(id), {
      headers: await cabecalhos()
    });
    if (!resposta.ok) {
      var corpo = {};
      try { corpo = await resposta.json(); } catch (e) { /* não era JSON */ }
      throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    }
    return resposta.blob();
  }

  /* ===== Preparo de laboratório (bastão lab → campo) =====
   * O laboratório preenche o pré-campo e ENVIA para um técnico designado; só o
   * celular dele recebe a oferta, e ele aceita explicitamente. Pacote fechado,
   * numa direção só — NÃO é o rascunho colaborativo antigo (removido). */
  var ROTA_PREPARO = BASE + '/preparo';

  async function getJsonPreparo(url) {
    var resposta = await fetch(url, { headers: await cabecalhos() });
    var corpo = {};
    try { corpo = await resposta.json(); } catch (e) { /* vazio */ }
    if (!resposta.ok || !corpo.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));
    return corpo;
  }

  // Quem pode receber o preparo: técnicos na AGENDA da OS → [{nome, email, temEmail}]
  async function tecnicosDaOs(numeroOs) {
    var corpo = await getJsonPreparo(ROTA_PREPARO + '?tecnicos=1&os=' + encodeURIComponent(numeroOs));
    return corpo.tecnicos || [];
  }

  // Envia o preparo (estado SEM fotos) para o designado. Exige internet + sessão.
  async function enviarPreparo(dados) {
    return postJson(ROTA_PREPARO, {
      acao: 'enviar',
      os: dados.os,
      servicoRef: dados.servicoRef,
      escopo: dados.escopo || '',
      destinatarioNome: dados.destinatarioNome,
      destinatarioEmail: dados.destinatarioEmail,
      estado: dados.estado
    });
  }

  // Preparos pendentes PARA MIM (o servidor casa pelo e-mail do login).
  async function meusPreparos() {
    var corpo = await getJsonPreparo(ROTA_PREPARO + '?meus=1');
    return corpo.preparos || [];
  }

  // Etiquetas leves da OS ("📦 Preparado para Fulano"), sem o estado.
  async function etiquetasPreparo(numeroOs) {
    var corpo = await getJsonPreparo(ROTA_PREPARO + '?os=' + encodeURIComponent(numeroOs));
    return corpo.etiquetas || [];
  }

  async function aceitarPreparo(id) { return postJson(ROTA_PREPARO, { acao: 'aceitar', id: id }); }
  async function cancelarPreparo(id) { return postJson(ROTA_PREPARO, { acao: 'cancelar', id: id }); }

  return {
    enviar: enviar,
    enviarPdf: enviarPdf,
    sincronizarRegistro: sincronizarRegistro,
    sincronizarRascunho: sincronizarRascunho,
    sincronizarRascunhoDados: sincronizarRascunhoDados,
    descartarRascunho: descartarRascunho,
    arquivarRascunho: arquivarRascunho,
    buscarRascunho: buscarRascunho,
    listarRascunhos: listarRascunhos,
    reenviarPdfsPendentes: reenviarPdfsPendentes,
    travar: travar,
    renovarTrava: renovarTrava,
    liberarTrava: liberarTrava,
    sincronizarPendentes: sincronizarPendentes,
    buscarBiblioteca: buscarBiblioteca,
    baixarDocumentoBiblioteca: baixarDocumentoBiblioteca,
    tecnicosDaOs: tecnicosDaOs,
    enviarPreparo: enviarPreparo,
    meusPreparos: meusPreparos,
    etiquetasPreparo: etiquetasPreparo,
    aceitarPreparo: aceitarPreparo,
    cancelarPreparo: cancelarPreparo
  };
})();
