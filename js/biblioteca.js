/**
 * biblioteca.js — Biblioteca de normas e procedimentos (gerenciada pelo SGP).
 *
 * A LISTA de documentos vem da API do SGP (tabela biblioteca_documentos) — é o
 * pessoal do escritório que adiciona/troca/remove, sem atualizar o app. A lista
 * fica guardada (localStorage) para abrir offline; cada PDF é baixado sob
 * demanda e guardado no IndexedDB (loja 'biblioteca') → abre SEM internet.
 *
 * A navegação é em NÍVEIS (mais fácil que uma lista comprida):
 *   1) escolhe o TIPO      → 📕 Legislação | 📘 Normas | 📗 Procedimentos
 *   2) escolhe a CATEGORIA → Ruído · Vibração · QAR Externo · QAR Interno ·
 *                            Opacidade · Geral
 *   3) vê os DOCUMENTOS daquela categoria (agrupados por método/norma).
 * Um "← Voltar" sobe um nível. A busca no topo, quando preenchida, mostra
 * resultados de todos os níveis de uma vez (atalho para quem já sabe o que quer).
 *
 * Tocar num documento: se já baixado, abre na hora (offline inclusive); senão
 * baixa, guarda e abre. "Baixar todos" deixa a biblioteca inteira offline antes
 * de ir a campo. O ✕ ao lado de um baixado apaga só a cópia do aparelho.
 *
 * O sino do app avisa quando há documento para baixar OU com versão nova no
 * servidor (o caminho `arquivo` muda a cada troca de PDF no SGP; guardamos o
 * caminho baixado e comparamos com o da lista).
 *
 * Interface (EC.biblioteca): abrir(), atualizarSino()
 * Depende de: EC.app (abrirOverlay, mostrarToast, atualizarSino), EC.sync
 * (buscarBiblioteca, baixarDocumentoBiblioteca), EC.db (loja 'biblioteca'),
 * EC.storage.
 */
window.EC = window.EC || {};

EC.biblioteca = (function () {
  'use strict';

  var CHAVE_LISTA = 'biblioteca:lista'; // lista de documentos (cache p/ offline)
  var CHAVE_VERSOES = 'biblioteca:versoes'; // id → `arquivo` no momento do download

  const TIPOS = [
    { chave: 'legislacao', titulo: 'Legislação', icone: '📕' },
    { chave: 'norma', titulo: 'Normas', icone: '📘' },
    { chave: 'procedimento', titulo: 'Procedimentos', icone: '📗' }
  ];
  // Nível atual da navegação. Zerado ao abrir.
  let nivel = { tipo: null, escopo: null };
  // Estado dos documentos: lista (metadados), ids baixados e downloads em curso.
  let lista = [];
  let baixados = {};   // id → true (tem o PDF no IndexedDB)
  let baixando = {};   // id → true (download em andamento)
  let versoes = {};    // id → `arquivo` que foi baixado (p/ detectar PDF trocado)

  function toast(msg) { if (EC.app && EC.app.mostrarToast) EC.app.mostrarToast(msg); }

  function docs() {
    return Array.isArray(lista) ? lista.filter(function (d) { return d && d.id && d.titulo; }) : [];
  }
  function docPorId(id) {
    return docs().filter(function (d) { return d.id === id; })[0] || null;
  }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function normalizar(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function escopoDe(d) { return (d.escopo || 'Geral').trim() || 'Geral'; }
  function tituloTipo(chave) {
    const t = TIPOS.filter(function (x) { return x.chave === chave; })[0];
    return t ? (t.icone + ' ' + t.titulo) : '';
  }
  function plural(n) { return n + ' ' + (n === 1 ? 'documento' : 'documentos'); }
  function fmtTamanho(b) {
    b = Number(b) || 0;
    if (!b) return '';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  // Categorias (escopos) em ordem alfabética.
  function ordenarEscopos(escopos) {
    return escopos.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  // Nº do POP a partir do título ("POP 001 …" → 1). Sem POP (normas) → Infinity,
  // caindo para a ordem alfabética. Serve para ordenar por sequência de POP.
  function popDe(d) {
    const m = String((d && d.titulo) || '').match(/POP\s*0*(\d+)/i);
    return m ? parseInt(m[1], 10) : Infinity;
  }
  function menorPop(lista2) {
    return lista2.reduce(function (min, d) { return Math.min(min, popDe(d)); }, Infinity);
  }

  function doTipo(chave) { return docs().filter(function (d) { return (d.tipo || '') === chave; }); }

  // Categorias (escopos) distintas de um tipo.
  function categoriasDe(chave) {
    const set = {};
    doTipo(chave).forEach(function (d) { set[escopoDe(d)] = true; });
    return Object.keys(set);
  }

  /* ---------- Lista: cache local + atualização pela API ---------- */

  function carregarListaLocal() {
    try {
      const guardada = EC.storage && EC.storage.ler && EC.storage.ler(CHAVE_LISTA);
      if (Array.isArray(guardada)) lista = guardada;
    } catch (e) { /* segue com a lista vazia */ }
  }

  // Busca a lista na API e regrava o cache. Silencioso quando offline/falha
  // (a tela segue com a última lista conhecida).
  function atualizarLista() {
    if (!navigator.onLine || !EC.sync || !EC.sync.buscarBiblioteca) return Promise.resolve(false);
    return EC.sync.buscarBiblioteca().then(function (documentos) {
      lista = documentos || [];
      try { EC.storage.salvar(CHAVE_LISTA, lista); } catch (e) { /* cache é best-effort */ }
      return true;
    }).catch(function () { return false; });
  }

  // Ids com PDF já guardado no aparelho.
  function carregarBaixados() {
    if (!EC.db || !EC.db.disponivel()) return Promise.resolve();
    return EC.db.keys('biblioteca').then(function (chaves) {
      baixados = {};
      (chaves || []).forEach(function (id) { baixados[id] = true; });
    }).catch(function () { /* segue sem marcar baixados */ });
  }

  /* ---------- Sino: o que falta baixar (ou atualizar) no aparelho ---------- */

  function carregarVersoes() {
    try {
      const v = EC.storage && EC.storage.ler && EC.storage.ler(CHAVE_VERSOES);
      if (v && typeof v === 'object') versoes = v;
    } catch (e) { /* segue sem versões conhecidas */ }
  }
  function salvarVersoes() {
    try { EC.storage.salvar(CHAVE_VERSOES, versoes); } catch (e) { /* best-effort */ }
  }

  // PDF trocado no SGP depois que este aparelho baixou? (`arquivo` muda a cada
  // troca). Download antigo, de antes de guardarmos versões, fica como "em dia"
  // — sem versão conhecida não dá para afirmar que mudou.
  function desatualizado(d) {
    return !!(baixados[d.id] && d.arquivo && versoes[d.id] && versoes[d.id] !== d.arquivo);
  }

  // Documentos que pedem download: nunca baixados ou com versão nova.
  function pendentesDownload() {
    return docs().filter(function (d) { return !baixados[d.id] || desatualizado(d); });
  }

  // Reporta a contagem ao sino único do app (fonte 'sgq').
  function reportarSino() {
    if (EC.app && EC.app.atualizarSino) EC.app.atualizarSino('sgq', pendentesDownload().length);
  }

  // Chamada no login e ao voltar a ficar online: atualiza a contagem do sino
  // sem precisar abrir a tela (lista fresca da API quando der; senão, cache).
  function atualizarSino() {
    carregarListaLocal();
    carregarVersoes();
    carregarBaixados().then(function () {
      reportarSino();
      return atualizarLista();
    }).then(function (mudou) { if (mudou) reportarSino(); });
  }

  /* ---------- Abrir / baixar / apagar um documento ---------- */

  // Abre o PDF (Blob). Tenta numa aba; se o navegador bloquear (PWA no iPhone),
  // cai para a folha de compartilhar/baixar — mesmo caminho dos PDFs de campo.
  function abrirBlob(blob, titulo) {
    const nome = String(titulo || 'documento').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
    const url = URL.createObjectURL(blob);
    let aba = null;
    try { aba = window.open(url, '_blank'); } catch (e) { aba = null; }
    if (aba) { setTimeout(function () { URL.revokeObjectURL(url); }, 60000); return; }
    URL.revokeObjectURL(url);
    let arquivo = null;
    try { arquivo = new File([blob], nome, { type: 'application/pdf' }); } catch (e) { arquivo = null; }
    if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] }) && navigator.share) {
      navigator.share({ files: [arquivo], title: titulo }).catch(function () { baixarComoArquivo(blob, nome); });
      return;
    }
    baixarComoArquivo(blob, nome);
  }
  function baixarComoArquivo(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Baixa o PDF de um documento e o guarda no aparelho. Devolve o Blob.
  function baixarDocumento(d) {
    baixando[d.id] = true;
    return EC.sync.baixarDocumentoBiblioteca(d.id).then(function (blob) {
      delete baixando[d.id];
      baixados[d.id] = true;
      if (d.arquivo) { versoes[d.id] = d.arquivo; salvarVersoes(); }
      reportarSino();
      return EC.db.set('biblioteca', d.id, blob).catch(function () { /* sem espaço? abre mesmo assim */ })
        .then(function () { return blob; });
    }).catch(function (e) {
      delete baixando[d.id];
      throw e;
    });
  }

  // Toque no documento: abre o que já está no aparelho; senão baixa e abre.
  // Com versão nova no servidor e internet, baixa a nova antes de abrir.
  function abrirDocumento(id) {
    const d = docPorId(id);
    if (!d || baixando[id]) return;
    EC.db.get('biblioteca', id).catch(function () { return null; }).then(function (blob) {
      if (blob && desatualizado(d) && navigator.onLine) blob = null; // força rebaixar
      if (blob) {
        if (desatualizado(d)) toast('📡 Sem conexão — abrindo a versão que está no aparelho.');
        abrirBlob(blob, d.titulo); return;
      }
      if (!navigator.onLine) { toast('📡 Sem conexão — este documento ainda não foi baixado.'); return; }
      pintar();
      baixarDocumento(d).then(function (novo) {
        pintar();
        abrirBlob(novo, d.titulo);
      }).catch(function () {
        pintar();
        toast('Não deu para baixar o documento. Tente de novo.');
      });
    });
  }

  // Apaga só a cópia offline (o documento continua na lista para baixar de novo).
  function apagarDownload(id) {
    const d = docPorId(id);
    EC.db.remove('biblioteca', id).catch(function () { }).then(function () {
      delete baixados[id];
      delete versoes[id];
      salvarVersoes();
      reportarSino();
      pintar();
      toast('Cópia offline apagada' + (d ? ' — "' + d.titulo + '"' : '') + '.');
    });
  }

  // Baixa em sequência todos os que faltam (para ir a campo com tudo offline).
  let baixandoTodos = false;
  function baixarTodos() {
    if (baixandoTodos) return;
    if (!navigator.onLine) { toast('📡 Sem conexão.'); return; }
    const faltam = pendentesDownload();
    if (!faltam.length) return;
    baixandoTodos = true;
    let feitos = 0, erros = 0;
    toast('📥 Baixando ' + plural(faltam.length) + '…');
    (function proximo(i) {
      if (i >= faltam.length) {
        baixandoTodos = false;
        pintar();
        toast(erros ? ('✓ ' + feitos + ' baixado(s), ' + erros + ' com erro — tente de novo.') : ('✓ Biblioteca completa no aparelho (' + feitos + ').'));
        return;
      }
      baixarDocumento(faltam[i]).then(function () { feitos++; }).catch(function () { erros++; })
        .then(function () { pintar(); proximo(i + 1); });
    })(0);
  }

  /* ---------- HTML de um documento ---------- */
  // Linha do documento: toque abre (baixando antes, se preciso). À direita, o
  // estado: "📥 · 2.1 MB" (falta baixar) · "⏳" (baixando) · "Abrir ›" (+ ✕ para
  // apagar a cópia). `sub` opcional aparece abaixo do título (usado na busca).
  function htmlDoc(d, sub) {
    let acao;
    if (baixando[d.id]) acao = '<span class="bib-doc-abrir">⏳ Baixando…</span>';
    else if (desatualizado(d)) acao = '<span class="bib-doc-abrir">🔄 Nova versão</span>' +
      '<button type="button" class="bib-doc-apagar" data-id="' + escapar(d.id) + '" title="Apagar a cópia offline">✕</button>';
    else if (baixados[d.id]) acao = '<span class="bib-doc-abrir">Abrir ›</span>' +
      '<button type="button" class="bib-doc-apagar" data-id="' + escapar(d.id) + '" title="Apagar a cópia offline">✕</button>';
    else acao = '<span class="bib-doc-abrir">📥' + (d.tamanho ? ' ' + fmtTamanho(d.tamanho) : '') + '</span>';
    return '<div class="bib-doc" data-id="' + escapar(d.id) + '" role="button" tabindex="0">' +
      '<span class="bib-doc-icone">📄</span>' +
      '<span class="bib-doc-titulo">' + escapar(d.titulo) + (sub ? '<small class="bib-doc-sub">' + escapar(sub) + '</small>' : '') + '</span>' +
      acao + '</div>';
  }

  /* ---------- Barra "baixar todos" (estado offline da biblioteca) ---------- */
  function htmlBarraOffline() {
    const total = docs().length;
    if (!total) return '';
    const pend = pendentesDownload();
    if (!pend.length) return '<p class="bib-offline-ok">✓ Biblioteca completa no aparelho — abre sem internet.</p>';
    const novas = pend.filter(desatualizado).length;
    let html = '<div class="bib-offline">📥 ' + (total - pend.length) + ' de ' + total + ' no aparelho' +
      (novas ? ' · 🔄 ' + novas + ' com versão nova' : '');
    if (navigator.onLine) html += '<button type="button" class="bib-baixar-todos">' + (baixandoTodos ? '⏳ Baixando…' : 'Baixar todos') + '</button>';
    return html + '</div>';
  }

  /* ---------- Nível 1: tipos ---------- */
  function htmlRaiz() {
    let html = '';
    TIPOS.forEach(function (t) {
      const n = doTipo(t.chave).length;
      if (!n) return; // não mostra um tipo sem documentos
      html += '<button type="button" class="bib-nav-card" data-tipo="' + t.chave + '">' +
        '<span class="bib-nav-icone">' + t.icone + '</span>' +
        '<span class="bib-nav-texto"><strong>' + escapar(t.titulo) + '</strong><small>' + plural(n) + '</small></span>' +
        '<span class="bib-nav-seta">›</span></button>';
    });
    if (!html) {
      return navigator.onLine
        ? '<p class="overlay-vazio">Nenhum documento na biblioteca ainda.</p>'
        : '<p class="overlay-vazio">📡 Sem conexão — conecte uma vez para carregar a lista da biblioteca.</p>';
    }
    return htmlBarraOffline() + html;
  }

  /* ---------- Nível 2: categorias (escopos) de um tipo ---------- */
  function htmlEscopos(tipoChave) {
    const porEscopo = {};
    doTipo(tipoChave).forEach(function (d) { const e = escopoDe(d); porEscopo[e] = (porEscopo[e] || 0) + 1; });
    let html = '<button type="button" class="bib-voltar">← Voltar</button>' +
      '<h2 class="bib-tipo">' + tituloTipo(tipoChave) + '</h2>';
    ordenarEscopos(Object.keys(porEscopo)).forEach(function (e) {
      html += '<button type="button" class="bib-nav-item" data-escopo="' + escapar(e) + '">' +
        '<span class="bib-nav-item-texto">' + escapar(e) + '</span>' +
        '<span class="bib-nav-count">' + porEscopo[e] + '</span><span class="bib-nav-seta">›</span></button>';
    });
    return html;
  }

  /* ---------- Nível 3: documentos de um tipo + categoria ---------- */
  function htmlDocumentos(tipoChave, escopo) {
    const lista2 = doTipo(tipoChave).filter(function (d) { return escopoDe(d) === escopo; });
    // agrupa por método, na ordem do menor POP (procedimentos em sequência de
    // POP; normas, sem POP, em ordem alfabética).
    const porMetodo = {};
    lista2.forEach(function (d) { const m = (d.metodo || '').trim(); (porMetodo[m] = porMetodo[m] || []).push(d); });
    let html = '<button type="button" class="bib-voltar">← Voltar</button>' +
      '<p class="bib-crumb">' + escapar(tituloTipo(tipoChave)) + ' › <strong>' + escapar(escopo) + '</strong></p>';
    Object.keys(porMetodo).sort(function (a, b) {
      const pa = menorPop(porMetodo[a]); const pb = menorPop(porMetodo[b]);
      if (pa !== pb) return pa - pb;
      if (!a) return 1; if (!b) return -1;
      return a.localeCompare(b, 'pt-BR');
    }).forEach(function (metodo) {
      if (metodo) html += '<p class="bib-metodo">' + escapar(metodo) + '</p>';
      porMetodo[metodo].sort(function (a, b) {
        const pa = popDe(a); const pb = popDe(b);
        if (pa !== pb) return pa - pb;
        return String(a.titulo).localeCompare(String(b.titulo), 'pt-BR');
      }).forEach(function (d) { html += htmlDoc(d); });
    });
    return html;
  }

  /* ---------- Busca (atalho, resultados de todos os níveis) ---------- */
  function htmlBusca(q) {
    const alvo = normalizar(q).trim();
    const achados = docs().filter(function (d) {
      return normalizar(d.titulo + ' ' + (d.escopo || '') + ' ' + (d.metodo || '')).indexOf(alvo) !== -1;
    }).sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'); });
    if (!achados.length) return '<p class="overlay-vazio">Nada encontrado para essa busca.</p>';
    return achados.map(function (d) {
      const t = TIPOS.filter(function (x) { return x.chave === d.tipo; })[0];
      const rotuloTipo = t ? t.titulo.replace(/s$/, '') : 'Documento';
      const sub = rotuloTipo + ' · ' + escopoDe(d) + (d.metodo ? ' · ' + d.metodo : '');
      return htmlDoc(d, sub);
    }).join('');
  }

  // Preenche a área conforme a busca / nível atual e religa os cliques.
  function pintar() {
    const area = document.getElementById('bib-area');
    if (!area) return;
    const busca = document.getElementById('bib-busca');
    const q = busca ? busca.value : '';

    if (q.trim()) area.innerHTML = htmlBusca(q);
    else if (!nivel.tipo) area.innerHTML = htmlRaiz();
    else if (!nivel.escopo) {
      // Uma única categoria (ex.: Legislação) → abre direto nos documentos
      // (sem um nível de categoria com um item só). O "← Voltar" desses
      // documentos volta ao topo, pois nivel.escopo continua nulo.
      const cats = categoriasDe(nivel.tipo);
      if (cats.length <= 1) area.innerHTML = htmlDocumentos(nivel.tipo, cats[0] || '');
      else area.innerHTML = htmlEscopos(nivel.tipo);
    }
    else area.innerHTML = htmlDocumentos(nivel.tipo, nivel.escopo);

    area.querySelectorAll('.bib-nav-card').forEach(function (b) {
      b.addEventListener('click', function () { nivel = { tipo: b.dataset.tipo, escopo: null }; pintar(); });
    });
    area.querySelectorAll('.bib-nav-item').forEach(function (b) {
      b.addEventListener('click', function () { nivel.escopo = b.dataset.escopo; pintar(); });
    });
    area.querySelectorAll('.bib-doc').forEach(function (el) {
      el.addEventListener('click', function () { abrirDocumento(el.dataset.id); });
    });
    area.querySelectorAll('.bib-doc-apagar').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); apagarDownload(b.dataset.id); });
    });
    const btnTodos = area.querySelector('.bib-baixar-todos');
    if (btnTodos) btnTodos.addEventListener('click', baixarTodos);
    const voltar = area.querySelector('.bib-voltar');
    if (voltar) voltar.addEventListener('click', function () {
      if (nivel.escopo) nivel.escopo = null; else nivel.tipo = null;
      pintar();
    });
  }

  function abrir() {
    nivel = { tipo: null, escopo: null };
    carregarListaLocal();
    carregarVersoes();
    EC.app.abrirOverlay('📚 Biblioteca',
      '<label class="overlay-busca"><input type="search" id="bib-busca" placeholder="🔍 Buscar por título, categoria ou norma…" autocomplete="off"></label>' +
      '<div id="bib-area"></div>');

    const busca = document.getElementById('bib-busca');
    if (busca) busca.addEventListener('input', pintar);
    pintar();

    // Em paralelo: marca o que já está no aparelho e busca a lista fresca na API.
    carregarBaixados().then(function () { pintar(); reportarSino(); });
    atualizarLista().then(function (mudou) { if (mudou) { pintar(); reportarSino(); } });
  }

  return { abrir: abrir, atualizarSino: atualizarSino };
})();
