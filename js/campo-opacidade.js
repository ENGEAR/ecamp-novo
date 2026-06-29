/**
 * campo-opacidade.js — Monitoramento em campo: OPACIDADE (fuligem veicular)
 *
 * Dois subtipos, decididos pelo escopo da OS:
 *   - Opacímetro  (Fuligem – Opacímetro)            → item 8.4 "Opacímetro"
 *   - Ringelmann  (Fuligem – Escala de Ringelmann)  → item 8.4 "Escala Ringelmann"
 * Em ambos a coleta é paginada por VEÍCULO (1–50).
 *
 * Interface (namespace global EC.campoOpacidade):
 *   EC.campoOpacidade.renderizar(container, ctx)
 *   EC.campoOpacidade.itensFaltando(estado) → ['V1: ...', ...]
 *   EC.campoOpacidade.TIPO_CARIMBO(estado) → texto do tipo p/ carimbo de foto
 *
 * Depende de: EC.gps, EC.foto, EC.paginacao.
 */
window.EC = window.EC || {};

EC.campoOpacidade = (function () {
  'use strict';

  const CHECKS_OPACIMETRO = [
    'Equipamento conectado e calibrado',
    'Acelerações preliminares realizadas',
    'Ensaio executado conforme método',
    '3 leituras válidas obtidas',
    'Dados registrados e conferidos'
  ];

  const SUBTIPOS = [
    { id: 'opacimetro', icone: '💨', nome: 'Opacímetro' },
    { id: 'ringelmann', icone: '🌫️', nome: 'Escala de Ringelmann' }
  ];

  let ctx = null;
  let raiz = null;
  let veiculoExibido = 1;
  let temporizadorSalvar = null;

  function $(seletor) { return raiz.querySelector(seletor); }
  function campo() { return ctx.estado.campo; }
  function salvar() { ctx.salvar(); }
  function salvarDevagar() {
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 400);
  }

  // Subtipo padrão pelo escopo da OS (pré-seleção dos cards).
  function subtipoPorEscopo(escopo) {
    return /ringelmann/i.test(escopo || '') ? 'ringelmann' : 'opacimetro';
  }
  function subtipo() {
    return campo().subtipo || subtipoPorEscopo((ctx.estado.servico || {}).escopo);
  }

  function tipoCarimbo() { return subtipo() === 'ringelmann' ? 'OPACIDADERINGELMANN' : 'OPACIMETRO'; }

  function htmlChecks(itens, prefixo) {
    return itens.map(function (texto, i) {
      return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + texto + '</span></label>';
    }).join('');
  }

  function vincular(elemento, alvo) {
    elemento.querySelectorAll('[data-campo]').forEach(function (el) {
      const c = el.dataset.campo;
      if (alvo[c] !== undefined && alvo[c] !== null) el.value = alvo[c];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        alvo[c] = el.value;
        salvarDevagar();
      });
    });
    elemento.querySelectorAll('[data-check]').forEach(function (el) {
      const c = el.dataset.check;
      alvo.checks = alvo.checks || {};
      el.checked = !!alvo.checks[c];
      el.addEventListener('change', function () {
        alvo.checks[c] = el.checked;
        salvarDevagar();
      });
    });
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.co-gps');
    if (!div) return null;
    return EC.gps.criar(div, {
      dadosIniciais: alvo.gps || null,
      aoCapturar: function (dados) { alvo.gps = dados; salvar(); }
    });
  }

  function montarFoto(elemento, alvo, numeroVeiculo) {
    const div = elemento.querySelector('.co-foto');
    if (!div) return;
    EC.foto.criar(div, {
      os: ctx.estado.os.numero,
      tipo: tipoCarimbo(),
      ponto: 'V' + String(numeroVeiculo).padStart(2, '0'),
      rotulo: '📷 Foto / evidência do veículo (obrigatória)',
      fotoInicial: alvo.foto || null,
      obterUtm: function () { return (alvo.gps && alvo.gps.textoUtm) || ''; },
      aoCapturar: function (foto) { alvo.foto = foto; salvar(); }
    });
  }

  /* ===== Campos gerais ===== */

  function renderizarGeral() {
    const area = $('#co-geral');
    $('#co-paginacao').innerHTML = '';
    $('#co-veiculo').innerHTML = '';
    const g = campo().geral;
    area.innerHTML =
      '<label>Quantidade de veículos (1–50)<input type="number" min="1" max="50" inputmode="numeric" data-campo="qtdeVeiculos"></label>';
    if (g.qtdeVeiculos === undefined) g.qtdeVeiculos = ctx.estado.dadosGerais.qtdePontos;
    vincular(area, g);
    area.querySelector('[data-campo="qtdeVeiculos"]').addEventListener('input', renderizarVeiculos);
    renderizarVeiculos();
  }

  /* ===== Veículos paginados ===== */

  function renderizarVeiculos() {
    const g = campo().geral;
    const total = Math.min(50, Math.max(1, parseInt(g.qtdeVeiculos, 10) || 0));
    if (!g.qtdeVeiculos || total < 1) { $('#co-paginacao').innerHTML = ''; $('#co-veiculo').innerHTML = ''; return; }
    while (campo().veiculos.length < total) campo().veiculos.push({});
    veiculoExibido = Math.min(veiculoExibido, total);
    EC.paginacao.criar($('#co-paginacao'), {
      total: total,
      rotulo: 'V',
      aoSair: function (numero) {
        if (!EC.foto.tem(campo().veiculos[numero - 1].foto)) {
          EC.app.mostrarToast('Tire a foto do veículo V' + numero + ' antes de sair.');
          return false;
        }
        return true;
      },
      aoMudar: function (n) { veiculoExibido = n; renderizarVeiculo(n); }
    });
    renderizarVeiculo(veiculoExibido);
  }

  function htmlLeiturasRingelmann() {
    let h = '<p class="grupo-checks-titulo">Leituras — Escala de Ringelmann (0 a 5)</p><div class="grade-2">';
    for (let i = 0; i < 10; i++) {
      h += '<label>' + (i + 1) + 'ª leitura<select data-campo="leitura' + i + '"><option value="">—</option>' +
        '<option>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>';
    }
    return h + '</div>';
  }

  function renderizarVeiculo(n) {
    const area = $('#co-veiculo');
    const veic = campo().veiculos[n - 1];
    if (!veic) { area.innerHTML = ''; return; }
    const sub = subtipo();

    let html = '<div class="cartao-ponto"><h2>Veículo V' + n + '</h2>' +
      '<label>Placa / identificação do veículo<input type="text" data-campo="placa"></label>';

    html += '<label>Ano do veículo<input type="text" inputmode="numeric" data-campo="ano"></label>';

    html += '<div class="co-gps"></div>' +
      '<label>Endereço completo (rua, número, cidade, estado)<input type="text" data-campo="endereco"></label>';

    if (sub === 'ringelmann') {
      html += '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        htmlLeiturasRingelmann() +
        '<label>Hora final<input type="time" data-campo="horaFinal"></label>' +
        '<div class="co-foto"></div>';
    } else {
      html += '<p class="grupo-checks-titulo">Ensaio</p>' + htmlChecks(CHECKS_OPACIMETRO, 'op') +
        '<div class="co-foto"></div>';
    }

    html += '<label>Observações<textarea rows="2" data-campo="observacoes"></textarea></label></div>';
    area.innerHTML = html;

    vincular(area, veic);
    montarGps(area, veic);
    montarFoto(area, veic, n);
  }

  /* ===== Validação ===== */

  function itensFaltandoDoVeiculo(veic, sub) {
    veic = veic || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = veic[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    reqVal('placa', 'placa / identificação');
    if (!veic.gps) falta.push('GPS');
    reqVal('endereco', 'endereço completo');
    if (sub === 'ringelmann') {
      reqVal('horaInicial', 'hora inicial');
      for (let i = 0; i < 10; i++) reqVal('leitura' + i, (i + 1) + 'ª leitura');
    } else {
      const checks = veic.checks || {};
      let n = 0;
      for (let i = 0; i < CHECKS_OPACIMETRO.length; i++) if (!checks['op' + i]) n++;
      if (n) falta.push(n + ' confirmação(ões) do ensaio');
    }
    if (!EC.foto.tem(veic.foto)) falta.push('foto / evidência do veículo');
    // Hora final e observações são opcionais.
    return falta;
  }

  function itensFaltando(estado) {
    const c = estado && estado.campo;
    if (!c || !c.geral) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(50, Math.max(1, parseInt(c.geral.qtdeVeiculos, 10) || 0));
    const out = [];
    if (!total) { out.push('a quantidade de veículos não foi definida'); return out; }
    const sub = c.subtipo || subtipoPorEscopo((estado.servico || {}).escopo);
    for (let i = 0; i < total; i++) {
      itensFaltandoDoVeiculo((c.veiculos || [])[i], sub).forEach(function (x) { out.push('V' + (i + 1) + ': ' + x); });
    }
    return out;
  }

  /* ===== Entrada ===== */

  function renderizarSubtipos() {
    const grade = $('#co-subtipos');
    grade.innerHTML = SUBTIPOS.map(function (s) {
      return '<button type="button" class="card-tipo' + (campo().subtipo === s.id ? ' card-tipo-ativo' : '') + '" data-subtipo="' + s.id + '">' +
        '<span class="card-tipo-icone">' + s.icone + '</span><span>' + s.nome + '</span></button>';
    }).join('');

    const det = subtipoPorEscopo((ctx.estado.servico || {}).escopo);
    const hint = $('#co-subtipo-hint');
    if (hint) {
      if (campo().subtipo === det) {
        hint.className = 'alerta alerta-info';
        hint.innerHTML = '✓ Subtipo pré-selecionado pelo escopo da OS. Você pode alterar se necessário.';
      } else {
        hint.className = '';
        hint.innerHTML = '';
      }
    }

    grade.querySelectorAll('[data-subtipo]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        const novo = botao.dataset.subtipo;
        if (campo().subtipo === novo) return;
        const temDados = campo().veiculos.length || Object.keys(campo().geral).length;
        if (temDados && !confirm('Trocar o subtipo apaga o que já foi preenchido no campo. Continuar?')) return;
        campo().subtipo = novo;
        campo().geral = {};
        campo().veiculos = [];
        veiculoExibido = 1;
        salvar();
        renderizarSubtipos();
        renderizarGeral();
      });
    });
  }

  function renderizar(container, contexto) {
    ctx = contexto;
    raiz = container;
    if (!ctx.estado.campo) ctx.estado.campo = { subtipo: null, geral: {}, veiculos: [] };
    if (!ctx.estado.campo.geral) ctx.estado.campo.geral = {};
    if (!ctx.estado.campo.veiculos) ctx.estado.campo.veiculos = [];
    if (!ctx.estado.campo.subtipo) {
      ctx.estado.campo.subtipo = subtipoPorEscopo((ctx.estado.servico || {}).escopo);
      if (ctx.salvar) ctx.salvar();
    }
    veiculoExibido = 1;
    container.innerHTML =
      '<p class="grupo-checks-titulo">Subtipo do monitoramento</p>' +
      '<div class="grade-tipos" id="co-subtipos"></div>' +
      '<div id="co-subtipo-hint"></div>' +
      '<div id="co-geral"></div>' +
      '<div id="co-paginacao" class="cr-paginacao"></div>' +
      '<div id="co-veiculo"></div>';
    renderizarSubtipos();
    renderizarGeral();
  }

  return {
    renderizar: renderizar,
    itensFaltando: itensFaltando,
    TIPO_CARIMBO: tipoCarimbo
  };
})();
