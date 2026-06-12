/**
 * fluxo.js — Fluxo de serviços (Fase 1: estrutura base)
 *
 * Controla o caminho Serviços de ponta a ponta:
 *   1.1 Escolha da OS (lista mockada — EC.osMock)
 *   1.2 Dados gerais do serviço
 *   Passo 2  Tipo de monitoramento (6 cards)
 *   Passo 3a Seleção de equipamentos  — placeholder (Fase 6)
 *   Passo 3b Pré-campo / Romaneio     — placeholder (Fases 2 e 4)
 *   Passo 4  Monitoramento em campo   — placeholder (Fases 2 e 4)
 *   Revisão                            — resumo simples (conteúdo final em aberto)
 *   Passo 5  Finalizar                 — placeholder (salvamento real na Fase 2)
 *
 * Interface (namespace global EC.fluxo):
 *   EC.fluxo.iniciar() → abre a tela 1.1 (lista de OS)
 *
 * Estado do serviço em preenchimento:
 *   - Guardado em localStorage na chave 'rascunho:fluxo_[NºOS]'.
 *   - Salvo AUTOMATICAMENTE a cada navegação entre passos (seção 2 da
 *     especificação) e também pelo botão 💾 Salvar rascunho.
 *   - Se o técnico selecionar uma OS já começada, pergunta:
 *     "Continuar preenchimento" ou "Reiniciar cadastro de serviço".
 *
 * Depende de: EC.storage, EC.osMock, EC.navegacao, EC.foto,
 * e EC.app (mostrarTela / mostrarToast / abrirOverlay — exposto pelo app.js).
 */
window.EC = window.EC || {};

EC.fluxo = (function () {
  'use strict';

  // Ordem das telas do fluxo (Fase 1)
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

  // Os 6 cards do Passo 2 (seção 4.6 da especificação)
  const TIPOS = [
    { id: 'ruido', icone: '🔊', nome: 'Ruído' },
    { id: 'sismo', icone: '🌍', nome: 'Vibração' },
    { id: 'qar', icone: '💨', nome: 'QAR Externo' },
    { id: 'opacidade', icone: '👁', nome: 'Opacidade' },
    { id: 'qarint', icone: '🏠', nome: 'QAR Interno' },
    { id: 'outro', icone: '📋', nome: 'Outro' }
  ];

  let estado = null;
  let telaExibida = null; // tela do fluxo realmente na tela (controla o recolhimento de campos)

  function $(id) { return document.getElementById(id); }

  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- Estado ---------- */

  function chaveEstado(numeroOs) {
    return 'rascunho:fluxo_' + numeroOs;
  }

  function novoEstado(os) {
    const agora = new Date();
    return {
      os: {
        numero: os.numero,
        cliente: os.cliente,
        endereco: os.endereco,
        resumo: os.resumo,
        qtdePontos: os.qtdePontos
      },
      // Codificação unívoca da OS (seção 2): [NºOS]_[Cliente]; o ponto é
      // acrescentado quando o registro de cada ponto existir (Fases 2+).
      codificacaoBase: os.numero + '_' + os.cliente,
      dadosGerais: {
        dataInicio: agora.getFullYear() + '-' + doisDigitos(agora.getMonth() + 1) + '-' + doisDigitos(agora.getDate()),
        horaInicio: doisDigitos(agora.getHours()) + ':' + doisDigitos(agora.getMinutes()),
        qtdePontos: os.qtdePontos,
        linkMaps: '',
        foto: null
      },
      tipo: null,
      passoAtual: 'tela-dados-gerais',
      atualizadoEm: agora.toISOString()
    };
  }

  function salvarEstado() {
    if (!estado) return false;
    estado.atualizadoEm = new Date().toISOString();
    return EC.storage.salvar(chaveEstado(estado.os.numero), estado);
  }

  /* ---------- Navegação entre passos ---------- */

  function irPara(idTela) {
    // recolhe o que estiver na tela atual antes de trocar
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();

    if (estado) {
      estado.passoAtual = idTela;
      salvarEstado(); // salvamento automático ao navegar (seção 2)
    }

    if (idTela === 'tela-os') renderizarListaOs();
    if (idTela === 'tela-dados-gerais') preencherDadosGerais();
    if (idTela === 'tela-tipo') renderizarTipos();
    if (idTela === 'tela-revisao') renderizarRevisao();

    telaExibida = idTela;
    EC.app.mostrarTela(idTela);
  }

  function anterior(idTela) { return PASSOS[Math.max(0, PASSOS.indexOf(idTela) - 1)]; }
  function proximo(idTela) { return PASSOS[Math.min(PASSOS.length - 1, PASSOS.indexOf(idTela) + 1)]; }

  /* ---------- 1.1 Escolha da OS ---------- */

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

    // OS já começada: Continuar ou Reiniciar (seção 4.4)
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

  /* ---------- 1.2 Dados gerais ---------- */

  function preencherDadosGerais() {
    $('dg-data').value = estado.dadosGerais.dataInicio;
    $('dg-hora').value = estado.dadosGerais.horaInicio;
    $('dg-os').value = estado.os.numero;
    $('dg-cliente').value = estado.os.cliente;
    $('dg-endereco').value = estado.os.endereco;
    $('dg-resumo').value = estado.os.resumo;
    $('dg-pontos').value = estado.dadosGerais.qtdePontos;
    $('dg-maps').value = estado.dadosGerais.linkMaps || '';

    // componente de foto do local (recriado por OS)
    const containerFoto = $('dg-foto');
    EC.foto.criar(containerFoto, {
      os: estado.os.numero,
      tipo: 'LOCAL',
      ponto: 'P0',
      rotulo: '📷 Foto do local do monitoramento',
      obterUtm: function () { return ''; },
      aoCapturar: function (foto) {
        estado.dadosGerais.foto = { nomeArquivo: foto.nomeArquivo, dataUrl: foto.dataUrl };
        salvarEstado();
      }
    });
    // mostra a foto já salva, se houver
    if (estado.dadosGerais.foto) {
      const previa = containerFoto.querySelector('.foto-previa');
      const nome = containerFoto.querySelector('.foto-nome');
      previa.src = estado.dadosGerais.foto.dataUrl;
      previa.classList.remove('oculto');
      nome.textContent = '📎 ' + estado.dadosGerais.foto.nomeArquivo;
    }
  }

  function coletarDadosGerais() {
    if (!estado) return;
    estado.dadosGerais.dataInicio = $('dg-data').value;
    estado.dadosGerais.horaInicio = $('dg-hora').value;
    estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.os.qtdePontos;
    estado.dadosGerais.linkMaps = $('dg-maps').value.trim();
  }

  /* ---------- Passo 2: tipo de monitoramento ---------- */

  function renderizarTipos() {
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
        estado.tipo = card.dataset.tipo;
        salvarEstado();
        renderizarTipos();
      });
    });
  }

  function nomeTipo(id) {
    const tipo = TIPOS.filter(function (t) { return t.id === id; })[0];
    return tipo ? tipo.icone + ' ' + tipo.nome : '—';
  }

  /* ---------- Revisão ---------- */

  function renderizarRevisao() {
    const linhas = [
      ['Nº da OS', estado.os.numero],
      ['Cliente', estado.os.cliente],
      ['Endereço', estado.os.endereco],
      ['Resumo do serviço', estado.os.resumo],
      ['Início do preenchimento', estado.dadosGerais.dataInicio.split('-').reverse().join('/') + ' às ' + estado.dadosGerais.horaInicio],
      ['Quantidade de pontos', estado.dadosGerais.qtdePontos],
      ['Link do Google Maps', estado.dadosGerais.linkMaps || '—'],
      ['Foto do local', estado.dadosGerais.foto ? '✅ anexada' : '—'],
      ['Tipo de monitoramento', nomeTipo(estado.tipo)]
    ];
    $('revisao-conteudo').innerHTML = linhas.map(function (linha) {
      return '<div class="resumo-linha"><span>' + linha[0] + '</span><strong>' + linha[1] + '</strong></div>';
    }).join('');
  }

  /* ---------- Amarração dos botões das telas do fluxo ---------- */

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
    montarNavegacao('tela-passo3b');
    montarNavegacao('tela-passo4');
    montarNavegacao('tela-revisao');

    // Passo 5 (placeholder de finalização)
    $('finalizar-salvar').addEventListener('click', function () {
      EC.app.mostrarToast('O salvamento real do registro entra na Fase 2.');
    });
    $('finalizar-novo').addEventListener('click', function () {
      estado = null;
      EC.app.mostrarTela('tela-acao');
    });
    montarNavegacao('tela-passo5', { aoProximo: null });
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
