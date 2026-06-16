/**
 * campo-ruido.js — Monitoramento em campo: RUÍDO (tipo piloto)
 *
 * Desenha o formulário de coleta do tipo Ruído com os 4 subtipos:
 *   🌳 externo · 🏠 interno · 🚆 ferroviário · ✈️ aeronáutico
 * Cada subtipo tem campos gerais próprios e campos por ponto (paginados).
 * Regras especiais implementadas:
 *   - interno: condições ambientais só no 1º ponto; checagem final só no último;
 *     cálculo de pontos pela área (1 a cada 30 m²); canvas do layout da sala.
 *   - ferroviário/aeronáutico: checks de instalação conforme a finalidade.
 *   - aeronáutico operacional: sem clima digitado (a estação meteorológica
 *     registra) — confirmado com a Raisa em 12/06/2026.
 *   - alerta de diferença entre checagens ≥ 0,5 dB e de vento ≥ 5 m/s.
 *
 * Interface (namespace global EC.campoRuido):
 *   EC.campoRuido.renderizar(container, ctx)
 *     ctx.estado : estado do fluxo (mutado: ctx.estado.campo = {subtipo, geral, pontos})
 *     ctx.salvar : função que persiste o estado no localStorage
 *   EC.campoRuido.TIPOS_CARIMBO[subtipo] → texto do tipo p/ carimbo de foto
 *     (ex.: 'RUIDOEXTERNO')
 *   EC.campoRuido.SUBTIPOS → [{id, icone, nome}]
 *
 * Depende de: EC.gps, EC.foto, EC.paginacao, EC.alertaVento, EC.checagens,
 * EC.canvasSala, EC.equipamentosMock.
 */
window.EC = window.EC || {};

EC.campoRuido = (function () {
  'use strict';

  const SUBTIPOS = [
    { id: 'externo', icone: '🌳', nome: 'Ambiente Externo' },
    { id: 'interno', icone: '🏠', nome: 'Ambiente Interno' },
    { id: 'ferroviario', icone: '🚆', nome: 'Ferroviário' },
    { id: 'aeronautico', icone: '✈️', nome: 'Aeronáutico' }
  ];

  // Fotos obrigatórias por subtipo (chave do dado → rótulo). Não se sai do
  // ponto sem todas tiradas.
  const FOTOS_POR_SUBTIPO = {
    externo: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']],
    interno: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto']],
    ferroviario: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']],
    aeronautico: [['fotoTelaIni', 'foto da tela (checagem inicial)'], ['fotoPonto', 'foto do ponto'], ['fotoTelaFim', 'foto da tela (checagem final)']]
  };

  const TIPOS_CARIMBO = {
    externo: 'RUIDOEXTERNO',
    interno: 'RUIDOINTERNO',
    ferroviario: 'RUIDOFERROVIARIO',
    aeronautico: 'RUIDOAERONAUTICO'
  };

  /* ===== Textos dos checks (da especificação) ===== */

  // Posicionamento do microfone (ruído externo): a altura muda conforme seja
  // longa duração (≥ 4 m) ou medição comum (1,2 a 1,5 m).
  const POSICIONAMENTO_EXTERNO_PADRAO = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Protetor de vento instalado'
  ];
  const POSICIONAMENTO_EXTERNO_LONGA = [
    'Altura mínima de 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Protetor de vento instalado'
  ];

  const CHECKS_MONTAGEM_EXTERNO = [
    'Instalado em tripé estável',
    'Garantida ausência de vibrações',
    'Conferidas as configurações do equipamento (ponderação A, tempo de integração, filtro de 1/3 oitava, áudio)',
    'Verificada a bateria e o funcionamento geral'
  ];

  const CHECKS_POSICIONAMENTO_INTERNO = [
    'Distribuir os pontos de forma uniforme no ambiente',
    'Garantir representatividade do campo sonoro',
    'Distância mínima de 0,5 m de paredes, teto e piso',
    'Distância mínima de 1 m de janelas, portas ou aberturas',
    'Garantir distância mínima de 0,7 m entre pontos',
    'Pontos distribuídos de forma representativa no ambiente',
    'Variar a altura do microfone entre os pontos (entre 1,2 e 1,5 m) sempre que possível',
    'Não é obrigatório usar protetor de vento no microfone'
  ];

  const CHECKS_MONTAGEM_INTERNO = [
    'Instalar em tripé estável',
    'Garantir ausência de vibrações',
    'Conferir configurações do equipamento (ponderação A, fast (F) e slow (S), tempo de medição, áudio)',
    'Configurar filtro 1/1 de oitava',
    'Verificar bateria e funcionamento geral'
  ];

  const CHECKS_LTOT = [
    'Medir com todas as fontes em operação',
    'Garantir que representa a condição real do ambiente'
  ];

  const CHECKS_LRES = [
    'Medir com a fonte objeto desligada (quando possível)',
    'Garantir ausência da contribuição da fonte avaliada',
    'Caso não seja possível desligar, medir em local equivalente e registrar justificativa'
  ];

  const CHECKS_INSTALACAO_FERRO = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Para longa duração: microfone preferencialmente ≥ 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória do tráfego ferroviário',
    'Definir pontos de medição em locais críticos (casas, escolas, hospitais etc.)'
  ];

  const CHECKS_PONTO_FERRO = [
    '🚃 Som residual — curto período: ao menos 15 min de medição (contínua ou não); monitoramento antes ou após a passagem da composição',
    '🚃 Som residual — longa duração: instalar equipamento para longa duração; diurno ≥ 60 min (contínua ou não); noturno ≥ 30 min (contínua ou não)',
    '🚂 Som da passagem ferroviária: considerar todo o tempo da passagem; mínimo de 3 passagens monitoradas; pelo menos 1 passagem em cada sentido; se densidade ≤ 3 composições/dia, medir pelo menos uma passagem; ⚠️ NÃO realizar durante cruzamento em linha dupla; sirenes, sinos, buzinas e campainhas são sons intrusivos; registrar características das composições (ex.: trem de carga, passageiro)',
    '🌡️ Condições ambientais: não monitorar com chuva (exceto se aprovação prévia); não monitorar com vento > 5 m/s'
  ];

  const CHECKS_INSTALACAO_AERO_RECEPTORES = [
    'Altura entre 1,2 m e 1,5 m do solo',
    'Para longa duração: microfone preferencialmente ≥ 4 m do solo',
    'Distância mínima de 2 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória das aeronaves',
    'Configurar ponderação A e filtro de 1/3 de oitava',
    '✅ Validação: ruído residual ≥ 10 dB abaixo do ruído das aeronaves',
    'Se diferença < 10 dB: acompanhar e anotar influências das aeronaves'
  ];

  const CHECKS_INSTALACAO_AERO_OPERACIONAL = [
    'Altura de 6 m do solo',
    'Distância mínima de 10 m de superfícies refletoras',
    'Uso obrigatório de protetor de vento',
    'Microfone direcionado para a trajetória das aeronaves',
    'Linha de visada livre para operações aéreas',
    'Configurar ponderação A e filtro de 1/3 de oitava',
    'Verificar cabo de extensão (quando aplicável)',
    'Instalar estrutura elevada e estável (quando aplicável)',
    'Conferir autonomia energética',
    'Verificar funcionamento da estação meteorológica',
    'Programar verificações elétricas automáticas',
    'Configurar armazenamento contínuo',
    'Validar sincronismo entre áudio, ruído e meteorologia',
    'Confirmar transmissão/coleta remota de dados',
    '✅ Validação: ruído residual ≥ 10 dB abaixo do ruído das aeronaves',
    'Se diferença < 10 dB: acompanhar e anotar influências das aeronaves'
  ];

  const CHECKS_PONTO_AERO_RECEPTORES = [
    'Não monitorar com chuva (exceto se aprovação prévia)',
    'Não monitorar com vento > 5 m/s',
    'Ruído residual monitorado',
    'Ruído total monitorado'
  ];

  let ctx = null;          // { estado, salvar }
  let raiz = null;         // container
  let pontoExibido = 1;
  let temporizadorSalvar = null;

  function $(seletor) { return raiz.querySelector(seletor); }

  function campo() { return ctx.estado.campo; }
  function ehLongaDuracao() { return /longa\s*dura/i.test((ctx.estado.servico && ctx.estado.servico.metodo) || ''); }

  // Rótulos das fotos obrigatórias ainda não tiradas de um ponto.
  function fotosFaltando(ponto, subtipo) {
    const reqs = FOTOS_POR_SUBTIPO[subtipo] || [['fotoPonto', 'foto do ponto']];
    return reqs.filter(function (f) { return !ponto || !ponto[f[0]]; }).map(function (f) { return f[1]; });
  }

  // Fotos que faltam no ponto exibido no momento (usado pelo "Próximo →" do fluxo).
  function pontoAtualIncompleto() {
    if (!ctx || !campo()) return [];
    return fotosFaltando(campo().pontos[pontoExibido - 1], campo().subtipo);
  }

  // Itens em branco de um ponto (campos + GPS + checagens + fotos). NÃO inclui
  // a hora de término (sempre opcional) nem os checks de confirmação.
  function itensFaltandoDoPonto(ponto, subtipo, indice, total, geral) {
    ponto = ponto || {};
    const falta = [];
    const reqVal = function (chave, rotulo) {
      const v = ponto[chave];
      if (v === undefined || v === null || String(v).trim() === '') falta.push(rotulo);
    };
    const primeiro = indice === 0;
    const ultimo = indice === total - 1;
    const operacional = geral && geral.finalidade === 'Monitoramento operacional';

    // comuns a todos os subtipos
    reqVal('nome', 'nome do ponto');
    reqVal('horaInicial', 'hora inicial');
    if (!ponto.gps) falta.push('GPS');
    reqVal('chkIniValor', 'checagem inicial');
    if (!ponto.fotoTelaIni) falta.push('foto da tela (checagem inicial)');
    if (!ponto.fotoPonto) falta.push('foto do ponto');

    if (subtipo === 'externo') {
      reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento');
      reqVal('fontesEmpresa', 'fontes da empresa'); reqVal('fontesAmbiente', 'fontes do ambiente');
      reqVal('chkFimValor', 'checagem final');
      if (!ponto.fotoTelaFim) falta.push('foto da tela (checagem final)');
      reqVal('observacoes', 'observações');
    } else if (subtipo === 'interno') {
      reqVal('altura', 'altura do sonômetro');
      if (primeiro) { reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento'); }
      reqVal('eventualidade', 'eventualidade');
      if (ponto.eventualidade === 'Sim') reqVal('eventualidadeDesc', 'descrição da eventualidade');
      if (ultimo) reqVal('chkFimValor', 'checagem final');
    } else if (subtipo === 'ferroviario') {
      reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento');
      reqVal('chkFimValor', 'checagem final');
      if (!ponto.fotoTelaFim) falta.push('foto da tela (checagem final)');
      reqVal('observacoes', 'observações');
    } else if (subtipo === 'aeronautico') {
      if (!operacional) { reqVal('temperatura', 'temperatura'); reqVal('umidade', 'umidade'); reqVal('vento', 'vento'); }
      reqVal('chkFimValor', 'checagem final');
      if (!ponto.fotoTelaFim) falta.push('foto da tela (checagem final)');
      reqVal('observacoes', 'observações');
    }
    return falta;
  }

  // Lista "P{n}: falta ..." de TODOS os pontos (usada para travar o salvamento).
  function itensFaltando(estado) {
    const campo = estado && estado.campo;
    if (!campo || !campo.subtipo) return ['o monitoramento em campo não foi iniciado'];
    const total = Math.min(20, Math.max(1, parseInt(campo.geral.qtdePontos, 10) || 0));
    if (!total) return ['a quantidade de pontos do campo não foi definida'];
    const lista = [];
    for (let i = 0; i < total; i++) {
      itensFaltandoDoPonto(campo.pontos[i], campo.subtipo, i, total, campo.geral).forEach(function (x) {
        lista.push('P' + (i + 1) + ': ' + x);
      });
    }
    return lista;
  }

  function salvar() { ctx.salvar(); }

  function salvarDevagar() {
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 400);
  }

  /* ===== Helpers de marcação ===== */

  function htmlChecks(itens, prefixo) {
    return itens.map(function (texto, i) {
      return '<label class="linha-check check-campo"><input type="checkbox" data-check="' + prefixo + i + '"><span>' + texto + '</span></label>';
    }).join('');
  }

  function htmlChecagem(titulo, prefixo) {
    return (
      '<fieldset class="checagem-bloco">' +
      '  <legend>' + titulo + '</legend>' +
      '  <div class="checagem-linha">' +
      '    <label>Sinal<select data-campo="' + prefixo + 'Sinal"><option value="+">+</option><option value="-">−</option></select></label>' +
      '    <label>Valor (dB)<input type="number" step="0.01" min="0" inputmode="decimal" data-campo="' + prefixo + 'Valor" placeholder="ex.: 0,10"></label>' +
      '  </div>' +
      '</fieldset>'
    );
  }

  function htmlClima(incluirChuva) {
    return (
      '<div class="grade-3">' +
      '  <label>Temperatura (°C)<input type="number" step="0.1" inputmode="decimal" data-campo="temperatura"></label>' +
      '  <label>Umidade (%)<input type="number" step="1" min="0" max="100" inputmode="numeric" data-campo="umidade"></label>' +
      '  <label>Vento (m/s)<input type="number" step="0.1" min="0" inputmode="decimal" data-campo="vento"></label>' +
      '</div>' +
      '<div class="alerta alerta-amarelo cr-alerta-vento oculto">⚠️ Esperar o vento abaixar. Não é aceito monitoramento com vento acima de 5 m/s.</div>' +
      (incluirChuva ? htmlChecks(['Não monitorar com chuva'], 'chuva') : '')
    );
  }

  // Vincula inputs [data-campo] e checks [data-check] de `elemento` ao objeto alvo
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

  function ativarAlertaVento(elemento, alvo) {
    const entrada = elemento.querySelector('[data-campo="vento"]');
    const alerta = elemento.querySelector('.cr-alerta-vento');
    if (!entrada || !alerta) return;
    function avaliar() {
      const valor = entrada.value === '' ? null : parseFloat(entrada.value.replace(',', '.'));
      alerta.classList.toggle('oculto', !EC.alertaVento.avaliar(valor));
    }
    entrada.addEventListener('input', avaliar);
    avaliar();
  }

  function ativarAlertaChecagens(elemento, alvo) {
    const alerta = elemento.querySelector('.cr-alerta-checagem');
    const resultado = elemento.querySelector('.cr-resultado-checagem');
    if (!alerta) return;
    function avaliar() {
      const vIni = parseFloat(String(alvo.chkIniValor || '').replace(',', '.'));
      const vFim = parseFloat(String(alvo.chkFimValor || '').replace(',', '.'));
      if (isNaN(vIni) || isNaN(vFim)) {
        alerta.classList.add('oculto');
        if (resultado) resultado.textContent = '';
        return;
      }
      const r = EC.checagens.calcular(alvo.chkIniSinal || '+', vIni, alvo.chkFimSinal || '+', vFim);
      const texto = r.diff.toFixed(2).replace('.', ',');
      if (r.alerta) {
        if (resultado) resultado.textContent = '';
        alerta.innerHTML = '🛑 <strong>Diferença entre checagens = ' + texto + ' dB (limite: 0,5 dB).</strong> Verificar o equipamento e repetir o monitoramento do ponto.';
        alerta.classList.remove('oculto');
      } else {
        alerta.classList.add('oculto');
        if (resultado) resultado.innerHTML = '✅ Diferença entre checagens = <strong>' + texto + ' dB</strong> — dentro do limite (0,5 dB).';
      }
    }
    elemento.querySelectorAll('[data-campo^="chk"]').forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', avaliar);
    });
    avaliar();
  }

  function montarGps(elemento, alvo) {
    const div = elemento.querySelector('.cr-gps');
    if (!div) return null;
    return EC.gps.criar(div, {
      dadosIniciais: alvo.gps || null,
      aoCapturar: function (dados) { alvo.gps = dados; salvar(); }
    });
  }

  function montarFoto(elemento, seletor, alvo, chave, rotulo, instanciaGps, numeroPonto) {
    const div = elemento.querySelector(seletor);
    if (!div) return;
    EC.foto.criar(div, {
      os: ctx.estado.os.numero,
      tipo: TIPOS_CARIMBO[campo().subtipo],
      ponto: 'P' + String(numeroPonto).padStart(2, '0'),
      rotulo: rotulo,
      fotoInicial: alvo[chave] || null,
      obterUtm: function () {
        if (instanciaGps && instanciaGps.textoCarimbo()) return instanciaGps.textoCarimbo();
        return (alvo.gps && alvo.gps.textoUtm) || '';
      },
      aoCapturar: function (foto) { alvo[chave] = foto; salvar(); }
    });
  }

  function categoriaDoEquip(codigo) {
    const lista = EC.equipamentosMock[ctx.estado.tipo] || [];
    const e = lista.filter(function (x) { return x.codigo === codigo; })[0];
    return e ? e.categoria : ('__' + codigo); // sem categoria conhecida: trata como única
  }

  // Padrão por ponto: marca só os equipamentos cuja categoria tem UMA unidade
  // selecionada. Categorias com 2+ unidades (ex.: dois sonômetros) vêm
  // DESMARCADAS, para o técnico escolher qual foi usado no ponto.
  function padraoEquipamentosPonto(selecionados) {
    const contagem = {};
    selecionados.forEach(function (c) { const cat = categoriaDoEquip(c); contagem[cat] = (contagem[cat] || 0) + 1; });
    return selecionados.filter(function (c) { return contagem[categoriaDoEquip(c)] === 1; });
  }

  function htmlEquipamentosPonto(alvo) {
    const selecionados = ctx.estado.equipamentos || [];
    if (!selecionados.length) {
      return '<p class="texto-apoio">Nenhum equipamento selecionado no pré-campo — volte à seleção de equipamentos se precisar.</p>';
    }
    if (!alvo.equipamentos) alvo.equipamentos = padraoEquipamentosPonto(selecionados);

    const contagem = {};
    selecionados.forEach(function (c) { const cat = categoriaDoEquip(c); contagem[cat] = (contagem[cat] || 0) + 1; });
    const temMultiplos = Object.keys(contagem).some(function (k) { return contagem[k] > 1; });

    return (temMultiplos ? '<p class="texto-apoio">Onde há mais de uma unidade do mesmo tipo, marque qual foi usada neste ponto.</p>' : '') +
      selecionados.map(function (codigo) {
        const marcado = alvo.equipamentos.indexOf(codigo) !== -1;
        return '<label class="linha-check check-campo"><input type="checkbox" data-equip="' + codigo + '"' + (marcado ? ' checked' : '') + '><span>' + codigo + '</span></label>';
      }).join('');
  }

  function vincularEquipamentos(elemento, alvo) {
    elemento.querySelectorAll('[data-equip]').forEach(function (el) {
      el.addEventListener('change', function () {
        alvo.equipamentos = alvo.equipamentos || [];
        const codigo = el.dataset.equip;
        const indice = alvo.equipamentos.indexOf(codigo);
        if (el.checked && indice === -1) alvo.equipamentos.push(codigo);
        if (!el.checked && indice !== -1) alvo.equipamentos.splice(indice, 1);
        salvarDevagar();
      });
    });
  }

  /* ===== Seleção do subtipo ===== */

  function renderizarSubtipos() {
    const grade = $('#cr-subtipos');
    grade.innerHTML = SUBTIPOS.map(function (s) {
      return '<button type="button" class="card-tipo' + (campo().subtipo === s.id ? ' card-tipo-ativo' : '') + '" data-subtipo="' + s.id + '">' +
        '<span class="card-tipo-icone">' + s.icone + '</span><span>' + s.nome + '</span></button>';
    }).join('');

    const det = EC.mapaEscopo && EC.mapaEscopo.subtipoPorEscopo
      ? EC.mapaEscopo.subtipoPorEscopo(ctx.estado.servico && ctx.estado.servico.escopo) : null;
    const hint = $('#cr-subtipo-hint');
    if (hint) {
      if (det && campo().subtipo === det) {
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
        const temDados = campo().subtipo && (campo().pontos.length || Object.keys(campo().geral).length);
        if (temDados && !confirm('Trocar o subtipo apaga o que já foi preenchido no campo. Continuar?')) return;
        campo().subtipo = novo;
        campo().geral = {};
        campo().pontos = [];
        pontoExibido = 1;
        salvar();
        renderizarSubtipos();
        renderizarGeral();
      });
    });
  }

  /* ===== Campos gerais por subtipo ===== */

  function renderizarGeral() {
    const area = $('#cr-geral');
    $('#cr-paginacao').innerHTML = '';
    $('#cr-ponto').innerHTML = '';
    const g = campo().geral;

    if (!campo().subtipo) { area.innerHTML = ''; return; }

    if (campo().subtipo === 'externo') {
      area.innerHTML =
        '<label>Finalidade do monitoramento<select data-campo="finalidade">' +
        '<option value="">Selecione…</option><option>Laudo PBH</option><option>Obra</option><option>Background</option><option>Operações</option><option>Outros</option>' +
        '</select></label>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>';
      if (g.qtdePontos === undefined) g.qtdePontos = ctx.estado.dadosGerais.qtdePontos;
      vincular(area, g);
      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', renderizarPontos);
      renderizarPontos();

    } else if (campo().subtipo === 'interno') {
      area.innerHTML =
        '<div class="grade-2">' +
        '  <label>Condição das esquadrias<select data-campo="esquadrias"><option value="">Selecione…</option><option>Aberta</option><option>Fechada</option></select></label>' +
        '  <label>Condição do ambiente<select data-campo="condicao"><option value="">Selecione…</option><option>Sala vazia</option><option>Com pessoas</option></select></label>' +
        '</div>' +
        '<p class="texto-apoio">💡 Monitorar, preferencialmente, sem pessoas.</p>' +
        '<label>Área do ambiente (m²)<input type="number" min="1" step="0.1" inputmode="decimal" data-campo="area"></label>' +
        '<button type="button" class="botao botao-secundario" id="cr-calcular">Calcular pontos necessários</button>' +
        '<div id="cr-interno-resultado"></div>';
      vincular(area, g);

      area.querySelector('#cr-calcular').addEventListener('click', function () {
        const m2 = parseFloat(String(g.area || '').replace(',', '.'));
        if (!m2 || m2 <= 0) { EC.app.mostrarToast('Informe a área do ambiente primeiro.'); return; }
        g.pontosCalculados = Math.max(1, Math.ceil(m2 / 30)); // 1 ponto a cada 30 m²
        salvar();
        renderizarInternoAposCalculo();
      });

      if (g.pontosCalculados) renderizarInternoAposCalculo();

    } else if (campo().subtipo === 'ferroviario') {
      area.innerHTML =
        '<label>Finalidade<select data-campo="finalidade">' +
        '<option value="">Selecione…</option><option>Passagem de composição ferroviária</option><option>Operações em pátios</option><option>Manobras</option><option>Cruzamentos</option>' +
        '</select></label>' +
        '<div id="cr-instalacao"></div>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>';
      if (g.qtdePontos === undefined) g.qtdePontos = ctx.estado.dadosGerais.qtdePontos;
      vincular(area, g);

      function instalacaoFerro() {
        const div = area.querySelector('#cr-instalacao');
        if (g.finalidade === 'Passagem de composição ferroviária') {
          div.innerHTML = '<p class="grupo-checks-titulo">Requisitos de instalação — passagem de composição</p>' + htmlChecks(CHECKS_INSTALACAO_FERRO, 'instal');
          vincular(div, g);
        } else {
          div.innerHTML = '';
        }
      }
      area.querySelector('[data-campo="finalidade"]').addEventListener('change', instalacaoFerro);
      instalacaoFerro();
      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', renderizarPontos);
      renderizarPontos();

    } else if (campo().subtipo === 'aeronautico') {
      area.innerHTML =
        '<label>Finalidade<select data-campo="finalidade">' +
        '<option value="">Selecione…</option><option>Receptores críticos</option><option>Monitoramento operacional</option>' +
        '</select></label>' +
        '<div id="cr-instalacao"></div>' +
        '<label>Quantidade de pontos (1–20)<input type="number" min="1" max="20" inputmode="numeric" data-campo="qtdePontos"></label>';
      if (g.qtdePontos === undefined) g.qtdePontos = ctx.estado.dadosGerais.qtdePontos;
      vincular(area, g);

      function instalacaoAero() {
        const div = area.querySelector('#cr-instalacao');
        if (g.finalidade === 'Receptores críticos') {
          div.innerHTML = '<p class="grupo-checks-titulo">Checks de instalação — receptores críticos</p>' + htmlChecks(CHECKS_INSTALACAO_AERO_RECEPTORES, 'instal');
        } else if (g.finalidade === 'Monitoramento operacional') {
          div.innerHTML = '<p class="grupo-checks-titulo">Checks de instalação — monitoramento operacional</p>' + htmlChecks(CHECKS_INSTALACAO_AERO_OPERACIONAL, 'instal');
        } else {
          div.innerHTML = '';
          return;
        }
        vincular(div, g);
      }
      area.querySelector('[data-campo="finalidade"]').addEventListener('change', function () {
        instalacaoAero();
        renderizarPonto(pontoExibido); // o formulário do ponto muda com a finalidade
      });
      instalacaoAero();
      area.querySelector('[data-campo="qtdePontos"]').addEventListener('input', renderizarPontos);
      renderizarPontos();
    }
  }

  function renderizarInternoAposCalculo() {
    const g = campo().geral;
    const div = $('#cr-interno-resultado');
    div.innerHTML =
      '<div class="alerta alerta-info">📐 Pontos necessários: <strong>' + g.pontosCalculados + '</strong> (1 ponto a cada 30 m²)</div>' +
      '<p class="grupo-checks-titulo">Posicionamento dos pontos</p>' + htmlChecks(CHECKS_POSICIONAMENTO_INTERNO, 'pos') +
      '<p class="grupo-checks-titulo">Montagem do equipamento</p>' + htmlChecks(CHECKS_MONTAGEM_INTERNO, 'mont') +
      '<p class="grupo-checks-titulo">Layout da sala</p>' +
      '<div id="cr-canvas-sala"></div>' +
      '<button type="button" class="botao botao-primario botao-largo" id="cr-ir-pontos">Ir para os pontos →</button>';
    vincular(div, g);

    const canvas = EC.canvasSala.criar(div.querySelector('#cr-canvas-sala'), {
      dadosIniciais: g.sala || null,
      aoMudar: function (objetos) {
        g.sala = { objetos: objetos };
        salvarDevagar();
      }
    });

    div.querySelector('#cr-ir-pontos').addEventListener('click', function () {
      g.qtdePontos = g.pontosCalculados;
      g.sala = { objetos: canvas.exportar().objetos };
      salvar();
      renderizarPontos();
      $('#cr-ponto').scrollIntoView({ behavior: 'smooth' });
    });

    if (g.qtdePontos) renderizarPontos();
  }

  /* ===== Pontos paginados ===== */

  function renderizarPontos() {
    const g = campo().geral;
    const total = Math.min(20, Math.max(1, parseInt(g.qtdePontos, 10) || 0));
    if (!g.qtdePontos || total < 1) { $('#cr-paginacao').innerHTML = ''; $('#cr-ponto').innerHTML = ''; return; }

    while (campo().pontos.length < total) campo().pontos.push({});
    // pontos além do total ficam guardados (não exibidos) — nada é apagado

    pontoExibido = Math.min(pontoExibido, total);
    EC.paginacao.criar($('#cr-paginacao'), {
      total: total,
      // Não deixa sair de um ponto sem as fotos obrigatórias dele
      aoSair: function (numero) {
        const faltando = fotosFaltando(campo().pontos[numero - 1], campo().subtipo);
        if (faltando.length) {
          EC.app.mostrarToast('Tire a(s) foto(s) do ponto P' + numero + ' antes de sair: ' + faltando.join(', ') + '.');
          return false;
        }
        return true;
      },
      aoMudar: function (n) {
        pontoExibido = n;
        renderizarPonto(n);
      }
    });
    renderizarPonto(pontoExibido);
  }

  function renderizarPonto(n) {
    const area = $('#cr-ponto');
    const ponto = campo().pontos[n - 1];
    if (!ponto) { area.innerHTML = ''; return; }
    const sub = campo().subtipo;
    const g = campo().geral;
    const total = Math.min(20, Math.max(1, parseInt(g.qtdePontos, 10) || 1));
    const primeiro = n === 1;
    const ultimo = n === total;

    let html = '<div class="cartao-ponto"><h2>Ponto P' + n + '</h2>';

    if (sub === 'externo') {
      html +=
        '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
        '<p class="grupo-checks-titulo">Equipamentos utilizados</p>' + htmlEquipamentosPonto(ponto) +
        '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        '<div class="cr-gps"></div>' +
        '<p class="grupo-checks-titulo">📍 Posicionamento do microfone</p>' +
        htmlChecks(ehLongaDuracao() ? POSICIONAMENTO_EXTERNO_LONGA : POSICIONAMENTO_EXTERNO_PADRAO, 'pos') +
        '<p class="grupo-checks-titulo">⚙️ Montagem do equipamento</p>' + htmlChecks(CHECKS_MONTAGEM_EXTERNO, 'mont') +
        htmlChecagem('Checagem inicial', 'chkIni') +
        '<div class="cr-foto-tela-ini"></div>' +
        '<div class="cr-foto-ponto"></div>' +
        '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(false) +
        htmlChecks(['Ruído residual monitorado', 'Ruído total monitorado'], 'ruido') +
        '<label>Fontes percebidas da EMPRESA<input type="text" data-campo="fontesEmpresa"></label>' +
        '<label>Fontes percebidas do AMBIENTE<input type="text" data-campo="fontesAmbiente"></label>' +
        htmlChecagem('Checagem final', 'chkFim') +
        '<div class="cr-resultado-checagem"></div>' +
        '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
        '<div class="cr-foto-tela-fim"></div>' +
        '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
        '<label>Hora de término<input type="time" data-campo="horaTermino"></label>';

    } else if (sub === 'interno') {
      html +=
        '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        '<label>Nome do ponto<input type="text" data-campo="nome"></label>' +
        '<div class="cr-gps"></div>' +
        '<label>Altura do sonômetro (m)<input type="number" step="0.01" inputmode="decimal" data-campo="altura"></label>' +
        htmlChecks(['Altura variando entre 1,2 e 1,5 m'], 'altura') +
        (primeiro
          ? '<p class="grupo-checks-titulo">🌡️ Condições ambientais (somente no primeiro ponto)</p>' + htmlClima(true)
          : '') +
        '<p class="grupo-checks-titulo">Ruído total (Ltot)</p>' + htmlChecks(CHECKS_LTOT, 'ltot') +
        '<p class="grupo-checks-titulo">Ruído residual (Lres)</p>' + htmlChecks(CHECKS_LRES, 'lres') +
        htmlChecagem('Checagem inicial', 'chkIni') +
        '<div class="cr-foto-tela-ini"></div>' +
        '<div class="cr-foto-ponto"></div>' +
        '<label>Eventualidade<select data-campo="eventualidade"><option value="">Selecione…</option><option>Não</option><option>Sim</option></select></label>' +
        '<div id="cr-eventualidade-desc"></div>' +
        (ultimo
          ? htmlChecagem('Checagem final (último ponto)', 'chkFim') +
            '<div class="cr-resultado-checagem"></div>' +
            '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>'
          : '') +
        '<label>Hora de término<input type="time" data-campo="horaTermino"></label>';

    } else if (sub === 'ferroviario') {
      html +=
        '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
        '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        '<div class="cr-gps"></div>' +
        htmlChecagem('Checagem inicial', 'chkIni') +
        '<div class="cr-foto-tela-ini"></div>' +
        htmlChecks(CHECKS_PONTO_FERRO, 'ferro') +
        '<div class="cr-foto-ponto"></div>' +
        '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(false) +
        htmlChecagem('Checagem final', 'chkFim') +
        '<div class="cr-resultado-checagem"></div>' +
        '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
        '<div class="cr-foto-tela-fim"></div>' +
        '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
        '<label>Hora de término<input type="time" data-campo="horaTermino"></label>';

    } else if (sub === 'aeronautico') {
      const operacional = g.finalidade === 'Monitoramento operacional';
      html +=
        '<label>Nome / identificação do ponto<input type="text" data-campo="nome"></label>' +
        '<label>Hora inicial<input type="time" data-campo="horaInicial"></label>' +
        '<div class="cr-gps"></div>' +
        htmlChecagem('Checagem inicial', 'chkIni') +
        '<div class="cr-foto-tela-ini"></div>' +
        '<div class="cr-foto-ponto"></div>' +
        (operacional
          ? htmlChecks(['Estação meteorológica funcionando'], 'estacao')
          : '<p class="grupo-checks-titulo">🌡️ Condições ambientais</p>' + htmlClima(false) +
            htmlChecks(CHECKS_PONTO_AERO_RECEPTORES, 'aero')) +
        htmlChecagem('Checagem final', 'chkFim') +
        '<div class="cr-resultado-checagem"></div>' +
        '<div class="alerta alerta-vermelho cr-alerta-checagem oculto"></div>' +
        '<div class="cr-foto-tela-fim"></div>' +
        '<label>Observações do ponto<textarea rows="2" data-campo="observacoes"></textarea></label>' +
        '<label>Hora de término<input type="time" data-campo="horaTermino"></label>';
    }

    html += '</div>';
    area.innerHTML = html;

    // vínculos e componentes
    vincular(area, ponto);
    vincularEquipamentos(area, ponto);
    ativarAlertaVento(area, ponto);
    ativarAlertaChecagens(area, ponto);
    const gpsInstancia = montarGps(area, ponto);
    montarFoto(area, '.cr-foto-tela-ini', ponto, 'fotoTelaIni', '📷 Foto da tela após checagem inicial (obrigatória)', gpsInstancia, n);
    montarFoto(area, '.cr-foto-ponto', ponto, 'fotoPonto', '📷 Foto do ponto (obrigatória)', gpsInstancia, n);
    montarFoto(area, '.cr-foto-tela-fim', ponto, 'fotoTelaFim', '📷 Foto da tela após checagem final (obrigatória)', gpsInstancia, n);

    // descrição da eventualidade (interno)
    const seletorEvent = area.querySelector('[data-campo="eventualidade"]');
    if (seletorEvent) {
      const divDesc = area.querySelector('#cr-eventualidade-desc');
      function descricaoEventualidade() {
        if (seletorEvent.value === 'Sim') {
          divDesc.innerHTML = '<label>Descreva a eventualidade<textarea rows="2" data-campo="eventualidadeDesc"></textarea></label>';
          vincular(divDesc, ponto);
        } else {
          divDesc.innerHTML = '';
        }
      }
      seletorEvent.addEventListener('change', descricaoEventualidade);
      descricaoEventualidade();
    }
  }

  /* ===== Entrada ===== */

  function renderizar(container, contexto) {
    ctx = contexto;
    raiz = container;
    if (!ctx.estado.campo) ctx.estado.campo = { subtipo: null, geral: {}, pontos: [] };
    pontoExibido = 1;

    // Pré-seleciona o subtipo pelo escopo da OS (o técnico pode trocar)
    if (!campo().subtipo && EC.mapaEscopo && EC.mapaEscopo.subtipoPorEscopo) {
      const sub = EC.mapaEscopo.subtipoPorEscopo(ctx.estado.servico && ctx.estado.servico.escopo);
      if (sub) { campo().subtipo = sub; if (ctx.salvar) ctx.salvar(); }
    }

    container.innerHTML =
      '<p class="grupo-checks-titulo">Subtipo do monitoramento</p>' +
      '<div class="grade-tipos" id="cr-subtipos"></div>' +
      '<div id="cr-subtipo-hint"></div>' +
      '<div id="cr-geral"></div>' +
      '<div id="cr-paginacao" class="cr-paginacao"></div>' +
      '<div id="cr-ponto"></div>';

    renderizarSubtipos();
    renderizarGeral();
  }

  return {
    renderizar: renderizar,
    TIPOS_CARIMBO: TIPOS_CARIMBO,
    SUBTIPOS: SUBTIPOS,
    FOTOS_POR_SUBTIPO: FOTOS_POR_SUBTIPO,
    pontoAtualIncompleto: pontoAtualIncompleto,
    itensFaltando: itensFaltando
  };
})();
