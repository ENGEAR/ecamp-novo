/**
 * fluxo.js — Fluxo de serviços (Fases 1 e 2)
 *
 * Controla o caminho Serviços de ponta a ponta:
 *   Escolha da OS (lista mockada — EC.osMock)
 *   Dados gerais do serviço
 *   Tipo de monitoramento (6 cards)
 *   Seleção de equipamentos (lista mockada — real na Fase 6)
 *   Pré-campo / Romaneio (checklist por tipo — EC.romaneios)
 *   Monitoramento em campo (Ruído completo — EC.campoRuido; demais na Fase 4)
 *   Revisão (resumo por seção + botões corrigir + avisos sem travar)
 *   Finalizar (salva o registro no localStorage com tela de sucesso)
 *
 * Interface (namespace global EC.fluxo):
 *   EC.fluxo.iniciar() → abre a tela de escolha da OS
 *
 * Estado do serviço em preenchimento:
 *   - Guardado em localStorage na chave 'rascunho:fluxo_[NºOS]'.
 *   - Salvo AUTOMATICAMENTE a cada navegação entre passos e pelos botões
 *     💾 Salvar rascunho.
 *   - OS já começada → pergunta "Continuar" ou "Reiniciar".
 *   - Ao finalizar, o registro vai para 'historico:' (máx. 20) e o rascunho
 *     do fluxo é removido.
 */
window.EC = window.EC || {};

EC.fluxo = (function () {
  'use strict';

  const PASSOS = [
    'tela-os',
    'tela-dados-gerais',
    'tela-tipo',
    'tela-passo3a',
    'tela-passo3b',
    'tela-passo4',
    'tela-revisao',
    'tela-passo5'
  ];

  const TIPOS = [
    { id: 'ruido', icone: '🔊', nome: 'Ruído' },
    { id: 'sismo', icone: '🌍', nome: 'Vibração' },
    { id: 'qar', icone: '💨', nome: 'QAR Externo' },
    { id: 'opacidade', icone: '👁', nome: 'Opacidade' },
    { id: 'qarint', icone: '🏠', nome: 'QAR Interno' },
    { id: 'outro', icone: '📋', nome: 'Outro' }
  ];

  let estado = null;
  let telaExibida = null;

  function $(id) { return document.getElementById(id); }

  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }

  function carimboDataHora(data) {
    return '' + data.getFullYear() + doisDigitos(data.getMonth() + 1) + doisDigitos(data.getDate())
      + '_' + doisDigitos(data.getHours()) + doisDigitos(data.getMinutes()) + doisDigitos(data.getSeconds());
  }

  /* ---------- Estado ---------- */

  function chaveEstado(numeroOs) {
    return 'rascunho:fluxo_' + numeroOs;
  }

  function novoEstado(os) {
    const agora = new Date();
    return {
      os: {
        numero: os.numero, cliente: os.cliente, endereco: os.endereco, resumo: os.resumo,
        escopo: os.escopo, qtdePontos: os.qtdePontos, metodo: os.metodo, periodo: os.periodo, observacao: os.observacao
      },
      codificacaoBase: os.numero + '_' + os.cliente,
      dadosGerais: {
        dataInicio: agora.getFullYear() + '-' + doisDigitos(agora.getMonth() + 1) + '-' + doisDigitos(agora.getDate()),
        horaInicio: doisDigitos(agora.getHours()) + ':' + doisDigitos(agora.getMinutes()),
        qtdePontos: os.qtdePontos,
        linkMaps: '',
        foto: null
      },
      tipo: null,
      equipamentos: [],
      preCampo: {},
      campo: null,
      passoAtual: 'tela-dados-gerais',
      atualizadoEm: agora.toISOString()
    };
  }

  function salvarEstado() {
    if (!estado) return false;
    estado.atualizadoEm = new Date().toISOString();
    return EC.storage.salvar(chaveEstado(estado.os.numero), estado);
  }

  /* ---------- Navegação ---------- */

  function irPara(idTela) {
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();

    if (estado) {
      estado.passoAtual = idTela;
      salvarEstado();
    }

    if (idTela === 'tela-os') renderizarListaOs();
    if (idTela === 'tela-dados-gerais') preencherDadosGerais();
    if (idTela === 'tela-tipo') renderizarTipos();
    if (idTela === 'tela-passo3a') renderizarEquipamentos();
    if (idTela === 'tela-passo3b') renderizarPreCampo();
    if (idTela === 'tela-passo4') renderizarCampo();
    if (idTela === 'tela-revisao') renderizarRevisao();
    if (idTela === 'tela-passo5') prepararFinalizar();

    telaExibida = idTela;
    EC.app.mostrarTela(idTela);
  }

  function anterior(idTela) { return PASSOS[Math.max(0, PASSOS.indexOf(idTela) - 1)]; }
  function proximo(idTela) { return PASSOS[Math.min(PASSOS.length - 1, PASSOS.indexOf(idTela) + 1)]; }

  /* ---------- Escolha da OS ---------- */

  function renderizarListaOs() {
    const lista = $('lista-os');
    lista.innerHTML = EC.osMock.map(function (os, i) {
      const emAndamento = EC.storage.ler(chaveEstado(os.numero)) !== null;
      return (
        '<button type="button" class="os-item" data-indice="' + i + '">' +
        '  <span class="os-numero">OS ' + os.numero + (emAndamento ? ' <span class="os-andamento">⏸️ em andamento</span>' : '') + '</span>' +
        '  <span class="os-cliente">' + os.cliente + '</span>' +
        '  <span class="os-resumo">' + os.resumo + '</span>' +
        '</button>'
      );
    }).join('');

    lista.querySelectorAll('.os-item').forEach(function (item) {
      item.addEventListener('click', function () {
        selecionarOs(EC.osMock[parseInt(item.dataset.indice, 10)]);
      });
    });
  }

  function selecionarOs(os) {
    const existente = EC.storage.ler(chaveEstado(os.numero));
    if (!existente) {
      estado = novoEstado(os);
      salvarEstado();
      irPara('tela-dados-gerais');
      return;
    }

    EC.app.abrirOverlay('OS ' + os.numero + ' já iniciada',
      '<p>Esta OS já tinha começado a ser preenchida' +
      (existente.atualizadoEm ? ' (último salvamento: ' + new Date(existente.atualizadoEm).toLocaleString('pt-BR') + ')' : '') +
      '. O que você quer fazer?</p>' +
      '<div class="pilha-botoes">' +
      '  <button type="button" class="botao botao-primario" id="os-continuar">✏️ Continuar preenchimento</button>' +
      '  <button type="button" class="botao botao-secundario" id="os-reiniciar">🔄 Reiniciar cadastro de serviço</button>' +
      '</div>');

    $('os-continuar').addEventListener('click', function () {
      EC.app.fecharOverlay();
      estado = existente;
      irPara(estado.passoAtual || 'tela-dados-gerais');
    });
    $('os-reiniciar').addEventListener('click', function () {
      EC.app.fecharOverlay();
      EC.storage.remover(chaveEstado(os.numero));
      estado = novoEstado(os);
      salvarEstado();
      irPara('tela-dados-gerais');
    });
  }

  /* ---------- Dados gerais ---------- */

  // Detalhe da OS (escopo, método, período, observação): usa o que está no
  // estado; se faltar (rascunho antigo), busca na lista de OS pelo número.
  function osDetalhe(campo) {
    if (estado.os[campo] !== undefined && estado.os[campo] !== null && estado.os[campo] !== '') return estado.os[campo];
    const m = EC.osMock.filter(function (o) { return o.numero === estado.os.numero; })[0];
    return (m && m[campo]) || '';
  }

  function preencherDadosGerais() {
    $('dg-data').value = estado.dadosGerais.dataInicio;
    $('dg-hora').value = estado.dadosGerais.horaInicio;
    $('dg-os').value = estado.os.numero;
    $('dg-cliente').value = estado.os.cliente;
    $('dg-endereco').value = estado.os.endereco;
    $('dg-resumo').value = estado.os.resumo;
    $('dg-escopo').value = osDetalhe('escopo');
    $('dg-pontos').value = estado.dadosGerais.qtdePontos;
    $('dg-metodo').value = osDetalhe('metodo');
    $('dg-periodo').value = osDetalhe('periodo');
    $('dg-observacao').value = osDetalhe('observacao');
    $('dg-maps').value = estado.dadosGerais.linkMaps || '';

    EC.foto.criar($('dg-foto'), {
      os: estado.os.numero,
      tipo: 'LOCAL',
      ponto: 'P0',
      rotulo: '📷 Foto do local do monitoramento',
      fotoInicial: estado.dadosGerais.foto || null,
      obterUtm: function () { return ''; },
      aoCapturar: function (foto) {
        estado.dadosGerais.foto = { nomeArquivo: foto.nomeArquivo, dataUrl: foto.dataUrl };
        salvarEstado();
      }
    });
  }

  function coletarDadosGerais() {
    if (!estado) return;
    estado.dadosGerais.dataInicio = $('dg-data').value;
    estado.dadosGerais.horaInicio = $('dg-hora').value;
    estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.os.qtdePontos;
    estado.dadosGerais.linkMaps = $('dg-maps').value.trim();
  }

  /* ---------- Tipo de monitoramento ---------- */

  function renderizarTipos() {
    // Pré-seleciona o tipo a partir do escopo da OS (o técnico pode trocar).
    const detectado = EC.mapaEscopo.tipoPorEscopo(osDetalhe('escopo'));
    if (!estado.tipo && detectado) {
      estado.tipo = detectado;
      salvarEstado();
    }

    const hint = $('tipo-hint');
    if (detectado && estado.tipo === detectado) {
      hint.className = 'alerta alerta-info';
      hint.innerHTML = '✓ Pré-selecionado pelo escopo da OS (“' + osDetalhe('escopo') + '”). Você pode alterar se necessário.';
    } else {
      hint.className = '';
      hint.innerHTML = '';
    }

    const grade = $('grade-tipos');
    grade.innerHTML = TIPOS.map(function (tipo) {
      const ativo = estado.tipo === tipo.id;
      return (
        '<button type="button" class="card-tipo' + (ativo ? ' card-tipo-ativo' : '') + '" data-tipo="' + tipo.id + '">' +
        '  <span class="card-tipo-icone">' + tipo.icone + '</span>' +
        '  <span>' + tipo.nome + '</span>' +
        '</button>'
      );
    }).join('');

    grade.querySelectorAll('.card-tipo').forEach(function (card) {
      card.addEventListener('click', function () {
        const novo = card.dataset.tipo;
        if (estado.tipo && estado.tipo !== novo && (estado.equipamentos.length || estado.campo)) {
          if (!confirm('Trocar o tipo apaga os equipamentos, o pré-campo e o que foi preenchido em campo. Continuar?')) return;
          estado.equipamentos = [];
          estado.preCampo = {};
          estado.campo = null;
        }
        estado.tipo = novo;
        salvarEstado();
        renderizarTipos();
      });
    });
  }

  function nomeTipo(id) {
    const tipo = TIPOS.filter(function (t) { return t.id === id; })[0];
    return tipo ? tipo.icone + ' ' + tipo.nome : '—';
  }

  /* ---------- Seleção de equipamentos (mock — real na Fase 6) ---------- */

  function renderizarEquipamentos() {
    const area = $('equipamentos-conteudo');
    const lista = EC.equipamentosMock[estado.tipo];

    if (!lista) {
      area.innerHTML = '<p class="texto-apoio">A seleção de equipamentos deste tipo entra nas próximas fases ' +
        '(lista da planilha F021 na Fase 6' + (estado.tipo === 'outro' ? '; para o tipo Outro, cadastro manual' : '') + ').</p>';
      return;
    }

    const categorias = [];
    lista.forEach(function (equip) {
      if (categorias.indexOf(equip.categoria) === -1) categorias.push(equip.categoria);
    });

    area.innerHTML =
      '<p class="texto-apoio">Lista de exemplo — a lista real (planilha F021, com validação de calibração) entra na Fase 6. Marque os equipamentos que vão para o campo.</p>' +
      categorias.map(function (categoria) {
        return '<p class="grupo-checks-titulo">' + categoria + '</p>' +
          lista.filter(function (e) { return e.categoria === categoria; }).map(function (e) {
            const marcado = estado.equipamentos.indexOf(e.codigo) !== -1;
            return '<label class="linha-check check-campo"><input type="checkbox" data-codigo="' + e.codigo + '"' + (marcado ? ' checked' : '') + '>' +
              '<span><strong>' + e.codigo + '</strong> — ' + e.descricao +
              (e.proximaCal ? '<br><small>próxima calibração: ' + e.proximaCal.split('-').reverse().join('/') + '</small>' : '') +
              '</span></label>';
          }).join('');
      }).join('');

    area.querySelectorAll('[data-codigo]').forEach(function (caixa) {
      caixa.addEventListener('change', function () {
        const codigo = caixa.dataset.codigo;
        const indice = estado.equipamentos.indexOf(codigo);
        if (caixa.checked && indice === -1) estado.equipamentos.push(codigo);
        if (!caixa.checked && indice !== -1) estado.equipamentos.splice(indice, 1);
        salvarEstado();
      });
    });
  }

  /* ---------- Pré-campo / Romaneio ---------- */

  function renderizarPreCampo() {
    EC.romaneios.renderizar($('precampo-conteudo'), estado.tipo, estado.preCampo, function () {
      salvarEstado();
    });
  }

  /* ---------- Monitoramento em campo ---------- */

  function renderizarCampo() {
    const area = $('campo-conteudo');
    if (estado.tipo === 'ruido') {
      EC.campoRuido.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else {
      area.innerHTML = '<p class="texto-grande">🚧 Em construção.</p>' +
        '<p>O formulário de campo de <strong>' + nomeTipo(estado.tipo) + '</strong> entra na Fase 4. O tipo Ruído já está completo — ele é o piloto.</p>';
    }
  }

  /* ---------- Revisão ---------- */

  function linhaResumo(rotulo, valor) {
    return '<div class="resumo-linha"><span>' + rotulo + '</span><strong>' + (valor === undefined || valor === null || valor === '' ? '—' : valor) + '</strong></div>';
  }

  function secaoRevisao(titulo, corpoHtml, telaCorrigir) {
    return '<div class="revisao-secao">' +
      '<div class="revisao-secao-topo"><h2>' + titulo + '</h2>' +
      '<button type="button" class="botao botao-mini" data-corrigir="' + telaCorrigir + '">✏️ Corrigir</button></div>' +
      corpoHtml + '</div>';
  }

  function avisosRevisao() {
    const avisos = [];
    if (!estado.tipo) avisos.push('Tipo de monitoramento não escolhido.');

    if (estado.tipo === 'ruido') {
      if (!estado.equipamentos.length) avisos.push('Nenhum equipamento selecionado.');
      const pendentesPre = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo);
      if (pendentesPre > 0) avisos.push('Pré-campo com ' + pendentesPre + ' item(ns) obrigatório(s) não conferido(s).');
      const campo = estado.campo;
      if (!campo || !campo.subtipo) {
        avisos.push('Monitoramento em campo não iniciado.');
      } else {
        const total = Math.min(20, Math.max(1, parseInt(campo.geral.qtdePontos, 10) || 0));
        if (!total) avisos.push('Quantidade de pontos do campo não definida.');
        for (let i = 0; i < total; i++) {
          const p = campo.pontos[i] || {};
          const nome = 'P' + (i + 1);
          if (!p.nome) avisos.push(nome + ': sem nome/identificação.');
          if (!p.gps) avisos.push(nome + ': GPS não capturado.');
          if (!p.chkIniValor) avisos.push(nome + ': checagem inicial não preenchida.');
          if (!p.fotoPonto) avisos.push(nome + ': sem foto do ponto.');
          const precisaFinal = campo.subtipo !== 'interno' || i === total - 1;
          if (precisaFinal && !p.chkFimValor) avisos.push(nome + ': checagem final não preenchida.');
        }
      }
    }
    return avisos;
  }

  function renderizarRevisao() {
    const area = $('revisao-conteudo');
    let html = '';

    html += secaoRevisao('📄 Dados gerais',
      linhaResumo('Nº da OS', estado.os.numero) +
      linhaResumo('Cliente', estado.os.cliente) +
      linhaResumo('Endereço', estado.os.endereco) +
      linhaResumo('Escopo', osDetalhe('escopo')) +
      linhaResumo('Início', estado.dadosGerais.dataInicio.split('-').reverse().join('/') + ' às ' + estado.dadosGerais.horaInicio) +
      linhaResumo('Pontos', estado.dadosGerais.qtdePontos) +
      linhaResumo('Método', osDetalhe('metodo')) +
      linhaResumo('Período', osDetalhe('periodo')) +
      linhaResumo('Observação', osDetalhe('observacao')) +
      linhaResumo('Link do Google Maps', estado.dadosGerais.linkMaps) +
      linhaResumo('Foto do local', estado.dadosGerais.foto ? '✅ anexada' : '—'),
      'tela-dados-gerais');

    html += secaoRevisao('🧭 Tipo de monitoramento', linhaResumo('Tipo', nomeTipo(estado.tipo)), 'tela-tipo');

    html += secaoRevisao('🔧 Equipamentos',
      linhaResumo('Selecionados', estado.equipamentos.length ? estado.equipamentos.join(', ') : '—'),
      'tela-passo3a');

    let resumoPre = '—';
    if (EC.romaneios.dados[estado.tipo]) {
      const pendentesPre = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo);
      resumoPre = pendentesPre === 0
        ? '✓ itens obrigatórios conferidos'
        : 'falta(m) ' + pendentesPre + ' item(ns) obrigatório(s)';
    }
    html += secaoRevisao('✅ Pré-campo', linhaResumo('Checklist', resumoPre), 'tela-passo3b');

    let corpoCampo = '<p class="texto-apoio">Monitoramento em campo não iniciado.</p>';
    if (estado.campo && estado.campo.subtipo) {
      const campo = estado.campo;
      const sub = EC.campoRuido.SUBTIPOS.filter(function (s) { return s.id === campo.subtipo; })[0];
      corpoCampo = linhaResumo('Subtipo', sub ? sub.icone + ' ' + sub.nome : campo.subtipo) +
        (campo.geral.finalidade ? linhaResumo('Finalidade', campo.geral.finalidade) : '') +
        (campo.geral.area ? linhaResumo('Área do ambiente (m²)', campo.geral.area) : '');
      const total = Math.min(20, Math.max(0, parseInt(campo.geral.qtdePontos, 10) || 0));
      for (let i = 0; i < total; i++) {
        const p = campo.pontos[i] || {};
        const fotos = ['fotoTelaIni', 'fotoPonto', 'fotoTelaFim'].filter(function (chave) { return p[chave]; }).length;
        corpoCampo += linhaResumo('P' + (i + 1) + (p.nome ? ' — ' + p.nome : ''),
          (p.gps ? '📍GPS ✓' : '📍GPS —') + ' · ' +
          (p.chkIniValor ? 'chk.ini ✓' : 'chk.ini —') + ' · ' +
          (p.chkFimValor ? 'chk.fim ✓' : 'chk.fim —') + ' · 📷 ' + fotos);
      }
    }
    html += secaoRevisao('📡 Em campo', corpoCampo, 'tela-passo4');

    const avisos = avisosRevisao();
    if (avisos.length) {
      html += '<div class="alerta alerta-amarelo"><strong>⚠️ Itens em branco (não impedem o salvamento):</strong><ul class="lista-avisos">' +
        avisos.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>';
    } else {
      html += '<div class="alerta alerta-info">✅ Tudo preenchido — nenhum aviso.</div>';
    }

    area.innerHTML = html;

    area.querySelectorAll('[data-corrigir]').forEach(function (botao) {
      botao.addEventListener('click', function () { irPara(botao.dataset.corrigir); });
    });
  }

  /* ---------- Finalizar ---------- */

  function prepararFinalizar() {
    $('finalizar-area').classList.remove('oculto');
    $('sucesso-area').classList.add('oculto');
    const avisos = avisosRevisao();
    $('finalizar-avisos').innerHTML = avisos.length
      ? '<div class="alerta alerta-amarelo">⚠️ ' + avisos.length + ' item(ns) em branco — veja na Revisão. O salvamento não é impedido.</div>'
      : '';
  }

  function montarRegistro() {
    const sessao = EC.storage.ler('sessao:atual') || {};
    const agora = new Date();
    const tipoTexto = estado.campo && estado.campo.subtipo
      ? EC.campoRuido.TIPOS_CARIMBO[estado.campo.subtipo]
      : (estado.tipo || 'SEMTIPO').toUpperCase();
    return {
      codificacao: 'OS_' + estado.os.numero + '_' + tipoTexto + '_' + carimboDataHora(agora),
      os: estado.os,
      tecnico: sessao.nome || '',
      tipo: estado.tipo,
      dadosGerais: estado.dadosGerais,
      equipamentos: estado.equipamentos,
      preCampo: estado.preCampo,
      campo: estado.campo,
      salvoEm: agora.toISOString()
    };
  }

  function salvarRegistro() {
    const registro = montarRegistro();
    if (!EC.storage.salvar('historico:' + registro.codificacao, registro)) {
      EC.app.mostrarToast('⚠️ Não foi possível salvar (memória do navegador cheia?).');
      return;
    }

    // mantém no máximo 20 registros no histórico (remove os mais antigos)
    const historico = EC.storage.listar('historico:')
      .sort(function (a, b) { return (a.valor.salvoEm || '').localeCompare(b.valor.salvoEm || ''); });
    while (historico.length > 20) {
      EC.storage.remover(historico.shift().chave);
    }

    EC.storage.remover(chaveEstado(estado.os.numero)); // rascunho do fluxo concluído

    $('finalizar-area').classList.add('oculto');
    const area = $('sucesso-area');
    area.classList.remove('oculto');
    $('sucesso-resumo').innerHTML =
      linhaResumo('Registro', registro.codificacao) +
      linhaResumo('Cliente', registro.os.cliente) +
      linhaResumo('Técnico', registro.tecnico) +
      linhaResumo('Tipo', nomeTipo(registro.tipo)) +
      linhaResumo('Salvo em', new Date(registro.salvoEm).toLocaleString('pt-BR'));

    estado = null;
    EC.app.atualizarBarraPendencias && EC.app.atualizarBarraPendencias();
  }

  /* ---------- Amarração dos botões ---------- */

  function aoSalvarRascunho() {
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();
    return salvarEstado();
  }

  function montarNavegacao(idTela, opcoesExtras) {
    const container = $(idTela.replace('tela-', '') + '-nav');
    EC.navegacao.criar(container, Object.assign({
      aoVoltar: function () { irPara(anterior(idTela)); },
      aoProximo: function () { irPara(proximo(idTela)); },
      aoSalvarRascunho: aoSalvarRascunho
    }, opcoesExtras || {}));
  }

  function inicializarTelas() {
    $('os-voltar').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });

    montarNavegacao('tela-dados-gerais', {
      aoVoltar: function () { irPara('tela-os'); }
    });

    montarNavegacao('tela-tipo', {
      aoProximo: function () {
        if (!estado.tipo) {
          EC.app.mostrarToast('Escolha um tipo de monitoramento para continuar.');
          return;
        }
        irPara('tela-passo3a');
      }
    });

    montarNavegacao('tela-passo3a');
    montarNavegacao('tela-passo3b', {
      aoProximo: function () {
        const pendentes = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo);
        if (pendentes > 0) {
          EC.app.mostrarToast('Conclua o pré-campo: falta(m) ' + pendentes + ' item(ns) obrigatório(s).');
          return;
        }
        irPara('tela-passo4');
      }
    });
    montarNavegacao('tela-passo4');
    montarNavegacao('tela-revisao');
    montarNavegacao('tela-passo5', { aoProximo: null });

    $('finalizar-salvar').addEventListener('click', salvarRegistro);
    $('finalizar-novo').addEventListener('click', function () {
      estado = null;
      EC.app.mostrarTela('tela-acao');
    });
    $('sucesso-novo').addEventListener('click', function () {
      EC.app.mostrarTela('tela-acao');
    });
    $('sucesso-pdf').addEventListener('click', function () {
      EC.app.mostrarToast('A geração de PDF entra na Fase 3.');
    });
  }

  let telasIniciadas = false;

  function iniciar() {
    if (!telasIniciadas) {
      telasIniciadas = true;
      inicializarTelas();
    }
    irPara('tela-os');
  }

  return { iniciar: iniciar };
})();
