/**
 * biblioteca.js — Biblioteca de normas e procedimentos (offline).
 *
 * Lista os documentos de `self.ECAMP_BIBLIOTECA` (js/biblioteca-dados.js). A
 * navegação é em NÍVEIS (mais fácil que uma lista comprida):
 *   1) escolhe o TIPO      → 📘 Normas  |  📗 Procedimentos
 *   2) escolhe a CATEGORIA → Ruído · Vibração · QAR Externo · QAR Interno ·
 *                            Opacidade · Geral
 *   3) vê os DOCUMENTOS daquela categoria (agrupados por método/norma).
 * Um "← Voltar" sobe um nível. A busca no topo, quando preenchida, mostra
 * resultados de todos os níveis de uma vez (atalho para quem já sabe o que quer).
 *
 * Os PDFs são pré-guardados pelo service worker → abrem SEM internet. Tocar num
 * documento abre o PDF numa nova aba.
 *
 * Interface (EC.biblioteca): abrir()
 * Depende de: EC.app (abrirOverlay).
 */
window.EC = window.EC || {};

EC.biblioteca = (function () {
  'use strict';

  const TIPOS = [
    { chave: 'legislacao', titulo: 'Legislação', icone: '📕' },
    { chave: 'norma', titulo: 'Normas', icone: '📘' },
    { chave: 'procedimento', titulo: 'Procedimentos', icone: '📗' }
  ];
  // Nível atual da navegação. Zerado ao abrir.
  let nivel = { tipo: null, escopo: null };

  function docs() {
    const lista = (typeof self !== 'undefined' && self.ECAMP_BIBLIOTECA) || [];
    return Array.isArray(lista) ? lista.filter(function (d) { return d && d.arquivo && d.titulo; }) : [];
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
  function menorPop(lista) {
    return lista.reduce(function (min, d) { return Math.min(min, popDe(d)); }, Infinity);
  }

  function doTipo(chave) { return docs().filter(function (d) { return (d.tipo || '') === chave; }); }

  // Categorias (escopos) distintas de um tipo.
  function categoriasDe(chave) {
    const set = {};
    doTipo(chave).forEach(function (d) { set[escopoDe(d)] = true; });
    return Object.keys(set);
  }

  // HTML de um documento (link que abre o PDF). `sub` opcional aparece abaixo do
  // título (usado na busca, para mostrar tipo/escopo/método).
  function htmlDoc(d, sub) {
    return '<a class="bib-doc" href="' + encodeURI(d.arquivo) + '" target="_blank" rel="noopener">' +
      '<span class="bib-doc-icone">📄</span>' +
      '<span class="bib-doc-titulo">' + escapar(d.titulo) + (sub ? '<small class="bib-doc-sub">' + escapar(sub) + '</small>' : '') + '</span>' +
      '<span class="bib-doc-abrir">Abrir ›</span></a>';
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
    return html || '<p class="overlay-vazio">Nenhum documento na biblioteca ainda.</p>';
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
    const lista = doTipo(tipoChave).filter(function (d) { return escopoDe(d) === escopo; });
    // agrupa por método, na ordem do menor POP (procedimentos em sequência de
    // POP; normas, sem POP, em ordem alfabética).
    const porMetodo = {};
    lista.forEach(function (d) { const m = (d.metodo || '').trim(); (porMetodo[m] = porMetodo[m] || []).push(d); });
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
      const rotuloTipo = (d.tipo === 'norma') ? 'Norma' : 'Procedimento';
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
    const voltar = area.querySelector('.bib-voltar');
    if (voltar) voltar.addEventListener('click', function () {
      if (nivel.escopo) nivel.escopo = null; else nivel.tipo = null;
      pintar();
    });
  }

  function abrir() {
    nivel = { tipo: null, escopo: null };
    const total = docs().length;
    EC.app.abrirOverlay('📚 Biblioteca',
      (total ? '<label class="overlay-busca"><input type="search" id="bib-busca" placeholder="🔍 Buscar por título, categoria ou norma…" autocomplete="off"></label>' : '') +
      '<div id="bib-area"></div>');

    const busca = document.getElementById('bib-busca');
    if (busca) busca.addEventListener('input', pintar);
    pintar();
  }

  return { abrir: abrir };
})();
