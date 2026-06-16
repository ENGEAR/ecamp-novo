/**
 * fluxo.js — Fluxo de serviços (Fases 1 e 2 + camada de múltiplos serviços)
 *
 * Uma OS pode ter VÁRIOS serviços (escopos). Caminho:
 *   Escolha da OS (lista mockada — EC.osMock)
 *   Serviços desta OS (só aparece se a OS tiver mais de um serviço; mostra
 *     cada serviço com situação 🆕/⏸️/✅ e deixa abrir qualquer um, em
 *     qualquer ordem — o técnico pode montar/iniciar vários em paralelo)
 *   → para o serviço escolhido, o fluxo completo:
 *       Dados gerais · Tipo (pré-selecionado pelo escopo) · Equipamentos ·
 *       Pré-campo · Em campo · Revisão · Finalizar
 *
 * Separação de dados:
 *   - Nível OS (compartilhado): cliente, endereço, resumo, observação, link do
 *     Maps e foto do local → 'rascunho:os_[NºOS]'.
 *   - Por serviço (independente): escopo, pontos, método, período, equipamentos,
 *     pré-campo, dados de campo, data/hora de início → 'rascunho:fluxo_[NºOS]__s[i]'.
 *   Cada serviço finalizado vira um registro próprio em 'historico:'.
 *
 * Interface (namespace global EC.fluxo):
 *   EC.fluxo.iniciar() → abre a tela de escolha da OS
 */
window.EC = window.EC || {};

EC.fluxo = (function () {
  'use strict';

  const PASSOS = [
    'tela-dados-gerais',
    'tela-tipo',
    'tela-passo3a',
    'tela-passo3b',
    'tela-checkpoint',
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

  let estado = null;       // estado do serviço aberto no momento
  let osAtual = null;      // objeto da OS em trabalho
  let multiServico = false;
  let telaExibida = null;

  function $(id) { return document.getElementById(id); }
  function doisDigitos(n) { return n < 10 ? '0' + n : '' + n; }
  function carimboDataHora(data) {
    return '' + data.getFullYear() + doisDigitos(data.getMonth() + 1) + doisDigitos(data.getDate())
      + '_' + doisDigitos(data.getHours()) + doisDigitos(data.getMinutes()) + doisDigitos(data.getSeconds());
  }

  // Toda data exibida no app fica no formato DD/MM/AAAA (recebe ISO AAAA-MM-DD)
  function formatarDataBR(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  // Situação da calibração de um equipamento pela data da próxima calibração:
  //   vencida (já passou) ou vencendo (faltam menos de 5 dias). null = ok.
  function statusCalibracao(proximaCalISO) {
    if (!proximaCalISO) return null;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const p = String(proximaCalISO).split('-');
    if (p.length !== 3) return null;
    const prox = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    const dias = Math.round((prox - hoje) / 86400000);
    if (dias < 0) return { nivel: 'vencida', texto: 'Calibração vencida. Não usar este equipamento.' };
    if (dias < 5) return { nivel: 'vencendo', texto: 'Calibração próxima do vencimento. Confirmar se este equipamento pode ser usado.' };
    return null;
  }

  /* ---------- Chaves de armazenamento ---------- */

  function chaveServico(numeroOs, indice) { return 'rascunho:fluxo_' + numeroOs + '__s' + indice; }
  function servicoId(numeroOs, indice) { return numeroOs + '__s' + indice; }

  /* ---------- Situação de cada serviço ---------- */

  function registroDoServico(numeroOs, indice) {
    const alvo = servicoId(numeroOs, indice);
    const achados = EC.storage.listar('historico:').filter(function (item) {
      return item.valor && item.valor.servicoId === alvo;
    });
    return achados.length ? achados[0].valor : null;
  }

  function situacaoServico(numeroOs, indice) {
    if (registroDoServico(numeroOs, indice)) return 'concluido';
    if (EC.storage.ler(chaveServico(numeroOs, indice))) return 'andamento';
    return 'novo';
  }

  const SELO = {
    novo: '<span class="servico-status status-novo">🆕 Não iniciado</span>',
    andamento: '<span class="servico-status status-andamento">⏸️ Em andamento</span>',
    concluido: '<span class="servico-status status-concluido">✅ Concluído</span>'
  };

  /* ---------- Estado do serviço ---------- */

  function novoEstadoServico(os, indice) {
    const agora = new Date();
    const servico = os.servicos[indice];
    return {
      osNumero: os.numero,
      servicoIndice: indice,
      servicoId: servicoId(os.numero, indice),
      os: { numero: os.numero, cliente: os.cliente, endereco: os.endereco, resumo: os.resumo, observacao: os.observacao, linkMaps: os.linkMaps || '' },
      servico: {
        campanha: servico.campanha, escopo: servico.escopo, metodo: servico.metodo,
        periodo: servico.periodo, observacao: servico.observacao, dias: servico.dias
      },
      dadosGerais: {
        dataInicio: agora.getFullYear() + '-' + doisDigitos(agora.getMonth() + 1) + '-' + doisDigitos(agora.getDate()),
        horaInicio: doisDigitos(agora.getHours()) + ':' + doisDigitos(agora.getMinutes()),
        qtdePontos: servico.qtdePontos,
        qtdePontosOS: servico.qtdePontos, // valor previsto na OS (fixo, p/ comparar)
        justificativaPontos: ''
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
    return EC.storage.salvar(chaveServico(estado.osNumero, estado.servicoIndice), estado);
  }

  function servicoDetalhe(campo) {
    return (estado.servico && estado.servico[campo]) || '';
  }

  /* ---------- Navegação ---------- */

  function irPara(idTela) {
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();
    if (estado) { estado.passoAtual = idTela; salvarEstado(); }

    if (idTela === 'tela-dados-gerais') preencherDadosGerais();
    if (idTela === 'tela-tipo') renderizarTipos();
    if (idTela === 'tela-passo3a') renderizarEquipamentos();
    if (idTela === 'tela-passo3b') renderizarPreCampo();
    if (idTela === 'tela-checkpoint') renderizarCheckpoint();
    if (idTela === 'tela-passo4') renderizarCampo();
    if (idTela === 'tela-revisao') renderizarRevisao();
    if (idTela === 'tela-passo5') prepararFinalizar();

    telaExibida = idTela;
    EC.app.mostrarTela(idTela);
  }

  function anterior(idTela) { return PASSOS[Math.max(0, PASSOS.indexOf(idTela) - 1)]; }
  function proximo(idTela) { return PASSOS[Math.min(PASSOS.length - 1, PASSOS.indexOf(idTela) + 1)]; }

  // Sair do primeiro passo do serviço: volta à lista de serviços (OS com vários)
  // ou à lista de OS (OS com um único serviço).
  function voltarDoServico() {
    if (estado && telaExibida === 'tela-dados-gerais') { coletarDadosGerais(); salvarEstado(); }
    estado = null;
    telaExibida = null; // evita que o próximo irPara colete da tela antiga
    if (multiServico) {
      renderizarServicos(osAtual);
      EC.app.mostrarTela('tela-servicos-os');
    } else {
      renderizarListaOs();
      EC.app.mostrarTela('tela-os');
    }
  }

  /* ---------- Escolha da OS ---------- */

  function resumoServicosOs(os) {
    let concluidos = 0, andamento = 0;
    os.servicos.forEach(function (s, i) {
      const st = situacaoServico(os.numero, i);
      if (st === 'concluido') concluidos++;
      else if (st === 'andamento') andamento++;
    });
    return { total: os.servicos.length, concluidos: concluidos, andamento: andamento };
  }

  function renderizarListaOs() {
    const lista = $('lista-os');
    lista.innerHTML = EC.osMock.map(function (os, i) {
      const r = resumoServicosOs(os);
      let badge = '';
      if (r.concluidos === r.total) badge = ' <span class="os-andamento status-concluido">✅ concluída</span>';
      else if (r.andamento > 0 || r.concluidos > 0) badge = ' <span class="os-andamento">⏸️ em andamento</span>';
      const linhaServicos = r.total > 1
        ? '<span class="os-resumo">' + r.total + ' serviços' + (r.concluidos ? ' · ' + r.concluidos + ' concluído(s)' : '') + '</span>'
        : '';
      return (
        '<button type="button" class="os-item" data-indice="' + i + '">' +
        '  <span class="os-numero">OS ' + os.numero + badge + '</span>' +
        '  <span class="os-cliente">' + os.cliente + '</span>' +
        '  <span class="os-resumo">' + os.resumo + '</span>' +
        linhaServicos +
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
    osAtual = os;
    multiServico = os.servicos.length > 1;
    if (multiServico) {
      renderizarServicos(os);
      EC.app.mostrarTela('tela-servicos-os');
    } else {
      aoTocarServico(os, 0);
    }
  }

  /* ---------- Serviços desta OS ---------- */

  function renderizarServicos(os) {
    $('servicos-os-sub').textContent = 'OS ' + os.numero + ' · ' + os.cliente;
    const lista = $('lista-servicos');

    // agrupa por campanha mantendo a ordem de aparição
    const campanhas = [];
    os.servicos.forEach(function (s) {
      const nome = s.campanha || 'Serviços';
      if (campanhas.indexOf(nome) === -1) campanhas.push(nome);
    });

    // Cadeado sequencial: uma campanha só libera quando a anterior está toda
    // concluída (o resto da OS é planejado no laboratório, campanha a campanha).
    let liberada = true;
    let campanhaAnterior = '';
    let html = '';
    campanhas.forEach(function (campanha) {
      const itens = os.servicos.map(function (s, i) { return { s: s, i: i }; })
        .filter(function (o) { return (o.s.campanha || 'Serviços') === campanha; });
      const estaLiberada = liberada;
      const todasConcluidas = itens.every(function (o) { return situacaoServico(os.numero, o.i) === 'concluido'; });

      html += '<p class="servico-campanha">' + campanha +
        (estaLiberada ? '' : ' <span class="servico-status status-bloqueado">🔒 bloqueada</span>') + '</p>';
      if (!estaLiberada) {
        html += '<p class="servico-bloqueio">Disponível depois de concluir a ' + campanhaAnterior + '.</p>';
      }

      html += itens.map(function (o) {
        const st = situacaoServico(os.numero, o.i);
        const info = '<span class="os-resumo">' + (o.s.qtdePontos ? o.s.qtdePontos + ' ponto(s)' : '') +
          (o.s.periodo ? ' · ' + o.s.periodo : '') + '</span>';
        if (!estaLiberada) {
          return (
            '<div class="os-item servico-item servico-bloqueado">' +
            '  <span class="os-numero">🔒 ' + o.s.escopo + '</span>' + info +
            '</div>'
          );
        }
        return (
          '<button type="button" class="os-item servico-item" data-indice="' + o.i + '">' +
          '  <span class="os-numero">▶️ ' + o.s.escopo + '</span>' + info +
          '  ' + SELO[st] +
          '</button>'
        );
      }).join('');

      campanhaAnterior = campanha;
      if (!todasConcluidas) liberada = false; // próximas campanhas ficam travadas
    });
    lista.innerHTML = html;

    lista.querySelectorAll('.servico-item[data-indice]').forEach(function (item) {
      item.addEventListener('click', function () {
        aoTocarServico(os, parseInt(item.dataset.indice, 10));
      });
    });
  }

  // Decide se abre direto, ou pergunta (continuar/reiniciar/refazer).
  function aoTocarServico(os, indice) {
    osAtual = os;
    multiServico = os.servicos.length > 1;
    const rascunho = EC.storage.ler(chaveServico(os.numero, indice));
    const registro = registroDoServico(os.numero, indice);
    const escopo = os.servicos[indice].escopo;

    if (rascunho) {
      EC.app.abrirOverlay(escopo,
        '<p>Este serviço já tinha começado a ser preenchido' +
        (rascunho.atualizadoEm ? ' (último salvamento: ' + new Date(rascunho.atualizadoEm).toLocaleString('pt-BR') + ')' : '') +
        '. O que você quer fazer?</p>' +
        '<div class="pilha-botoes">' +
        '  <button type="button" class="botao botao-primario" id="sv-continuar">✏️ Continuar preenchimento</button>' +
        '  <button type="button" class="botao botao-secundario" id="sv-reiniciar">🔄 Reiniciar este serviço</button>' +
        '</div>');
      $('sv-continuar').addEventListener('click', function () {
        EC.app.fecharOverlay();
        abrirServico(os, indice, rascunho);
      });
      $('sv-reiniciar').addEventListener('click', function () {
        EC.app.fecharOverlay();
        EC.storage.remover(chaveServico(os.numero, indice));
        abrirServico(os, indice, null);
      });
      return;
    }

    if (registro) {
      EC.app.abrirOverlay(escopo,
        '<p>Este serviço já foi <strong>concluído</strong>' +
        (registro.salvoEm ? ' em ' + new Date(registro.salvoEm).toLocaleString('pt-BR') : '') +
        '. Deseja refazer o cadastro?</p>' +
        '<div class="pilha-botoes">' +
        '  <button type="button" class="botao botao-primario" id="sv-refazer">🔄 Refazer cadastro</button>' +
        '  <button type="button" class="botao botao-secundario" id="sv-cancelar">Cancelar</button>' +
        '</div>');
      $('sv-refazer').addEventListener('click', function () {
        EC.app.fecharOverlay();
        abrirServico(os, indice, null);
      });
      $('sv-cancelar').addEventListener('click', EC.app.fecharOverlay);
      return;
    }

    abrirServico(os, indice, null);
  }

  function abrirServico(os, indice, rascunhoExistente) {
    telaExibida = null; // entrando em serviço novo: não coletar da tela anterior
    estado = rascunhoExistente || novoEstadoServico(os, indice);
    // garante campos novos em rascunhos antigos
    estado.os.linkMaps = os.linkMaps || estado.os.linkMaps || '';
    if (estado.dadosGerais.qtdePontosOS === undefined) estado.dadosGerais.qtdePontosOS = os.servicos[indice].qtdePontos;
    if (estado.dadosGerais.justificativaPontos === undefined) estado.dadosGerais.justificativaPontos = '';
    salvarEstado();
    irPara(estado.passoAtual || 'tela-dados-gerais');
  }

  /* ---------- Dados gerais ---------- */

  function preencherDadosGerais() {
    $('dg-data').value = formatarDataBR(estado.dadosGerais.dataInicio);
    $('dg-hora').value = estado.dadosGerais.horaInicio;
    $('dg-os').value = estado.os.numero;
    $('dg-cliente').value = estado.os.cliente;
    $('dg-endereco').value = estado.os.endereco;
    $('dg-resumo').value = estado.os.resumo;
    $('dg-escopo').value = servicoDetalhe('escopo');
    $('dg-pontos').value = estado.dadosGerais.qtdePontos;
    $('dg-pontos-os').textContent = '(previsto na OS: ' + estado.dadosGerais.qtdePontosOS + ')';
    $('dg-justificativa').value = estado.dadosGerais.justificativaPontos || '';
    $('dg-dias').value = (estado.servico.dias !== undefined && estado.servico.dias !== null && estado.servico.dias !== '') ? estado.servico.dias : '—';
    $('dg-periodo').value = servicoDetalhe('periodo');
    $('dg-metodo').value = servicoDetalhe('metodo');
    $('dg-observacao').value = servicoDetalhe('observacao');
    $('dg-maps').value = estado.os.linkMaps || '';
    atualizarJustificativaPontos();

    $('dg-pontos').oninput = function () {
      estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.dadosGerais.qtdePontos;
      atualizarJustificativaPontos();
      salvarEstado();
    };
    $('dg-justificativa').oninput = function () {
      estado.dadosGerais.justificativaPontos = $('dg-justificativa').value;
      salvarEstado();
    };
  }

  function pontosAlterados() {
    return parseInt(estado.dadosGerais.qtdePontos, 10) !== parseInt(estado.dadosGerais.qtdePontosOS, 10);
  }

  function atualizarJustificativaPontos() {
    $('dg-justificativa-bloco').classList.toggle('oculto', !pontosAlterados());
  }

  function coletarDadosGerais() {
    if (!estado) return;
    // data/hora e Maps são só leitura (vêm da OS/preenchimento automático)
    estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.dadosGerais.qtdePontos;
    estado.dadosGerais.justificativaPontos = $('dg-justificativa').value.trim();
  }

  /* ---------- Tipo de monitoramento ---------- */

  function renderizarTipos() {
    const detectado = EC.mapaEscopo.tipoPorEscopo(servicoDetalhe('escopo'));
    if (!estado.tipo && detectado) { estado.tipo = detectado; salvarEstado(); }

    const hint = $('tipo-hint');
    if (detectado && estado.tipo === detectado) {
      hint.className = 'alerta alerta-info';
      hint.innerHTML = '✓ Pré-selecionado pelo escopo da OS (“' + servicoDetalhe('escopo') + '”). Você pode alterar se necessário.';
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
          if (!confirm('Trocar o tipo apaga os equipamentos, o pré-campo e o que foi preenchido em campo deste serviço. Continuar?')) return;
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

    // Equipamento com calibração vencida não pode ser usado: se algum estava
    // selecionado e venceu, remove da seleção antes de desenhar.
    const antes = estado.equipamentos.length;
    estado.equipamentos = estado.equipamentos.filter(function (cod) {
      const e = lista.filter(function (x) { return x.codigo === cod; })[0];
      const cal = e ? statusCalibracao(e.proximaCal) : null;
      return !(cal && cal.nivel === 'vencida');
    });
    if (estado.equipamentos.length !== antes) salvarEstado();

    const categorias = [];
    lista.forEach(function (equip) {
      if (categorias.indexOf(equip.categoria) === -1) categorias.push(equip.categoria);
    });

    area.innerHTML =
      '<p class="texto-apoio">Lista de exemplo — a lista real (planilha F021, com validação de calibração) entra na Fase 6. Marque os equipamentos que vão para o campo. É necessário ao menos um de cada categoria.</p>' +
      categorias.map(function (categoria) {
        let tag = '';
        if (ehEstacaoMeteorologica(categoria)) {
          tag = ehLongaDuracao()
            ? ' <span class="romaneio-opcional">(obrigatório em longa duração)</span>'
            : ' <span class="romaneio-opcional">(opcional)</span>';
        }
        return '<p class="grupo-checks-titulo">' + categoria + tag + '</p>' +
          lista.filter(function (e) { return e.categoria === categoria; }).map(function (e) {
            const cal = statusCalibracao(e.proximaCal);
            const vencida = cal && cal.nivel === 'vencida';
            const marcado = !vencida && estado.equipamentos.indexOf(e.codigo) !== -1;
            const aviso = cal ? '<br><span class="cal-aviso cal-' + cal.nivel + '">' +
              (cal.nivel === 'vencida' ? '⛔ ' : '⚠️ ') + cal.texto + '</span>' : '';
            return '<label class="linha-check check-campo' + (vencida ? ' equip-bloqueado' : '') + '">' +
              '<input type="checkbox" data-codigo="' + e.codigo + '"' + (marcado ? ' checked' : '') + (vencida ? ' disabled' : '') + '>' +
              '<span><strong>' + e.codigo + '</strong> — ' + e.descricao +
              (e.proximaCal ? '<br><small>próxima calibração: ' + formatarDataBR(e.proximaCal) + '</small>' : '') +
              aviso +
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

  // OS de longa duração: o método (ou o período) do serviço diz "Longa duração"
  function ehLongaDuracao() {
    const s = estado.servico || {};
    return /longa\s*dura/i.test((s.metodo || '') + ' ' + (s.periodo || ''));
  }

  function opcoesRomaneio() {
    return { longaDuracao: ehLongaDuracao() };
  }

  /* ---------- Obrigatoriedade dos equipamentos (≥ 1 por categoria) ---------- */

  function ehEstacaoMeteorologica(categoria) {
    return /esta[çc].*meteor/i.test(categoria || '');
  }

  // Categorias obrigatórias ainda sem nenhum equipamento selecionado.
  // Toda categoria exige ao menos um, EXCETO Estação Meteorológica, que só é
  // obrigatória em longa duração.
  function categoriasEquipFaltando() {
    const lista = EC.equipamentosMock[estado.tipo];
    if (!lista) return []; // tipos sem lista (Fase 6) não validam aqui
    const categorias = [];
    lista.forEach(function (e) { if (categorias.indexOf(e.categoria) === -1) categorias.push(e.categoria); });
    return categorias.filter(function (cat) {
      const obrigatoria = ehEstacaoMeteorologica(cat) ? ehLongaDuracao() : true;
      if (!obrigatoria) return false;
      const temUm = lista.some(function (e) { return e.categoria === cat && estado.equipamentos.indexOf(e.codigo) !== -1; });
      return !temUm;
    });
  }

  function renderizarPreCampo() {
    EC.romaneios.renderizar($('precampo-conteudo'), estado.tipo, estado.preCampo, function () {
      salvarEstado();
    }, opcoesRomaneio());
  }

  /* ---------- Transição preparação → campo ---------- */

  function renderizarCheckpoint() {
    const equip = estado.equipamentos.length;
    const pendentesPre = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo);
    $('checkpoint-resumo').innerHTML =
      linhaResumo('Tipo', nomeTipo(estado.tipo)) +
      linhaResumo('Método', servicoDetalhe('metodo')) +
      linhaResumo('Período', servicoDetalhe('periodo')) +
      linhaResumo('Equipamentos', equip ? equip + ' selecionado(s)' : '—') +
      linhaResumo('Pré-campo', pendentesPre === 0 ? '✓ obrigatórios conferidos' : 'falta(m) ' + pendentesPre + ' item(ns)');
  }

  /* ---------- Monitoramento em campo ---------- */

  function renderizarCampo() {
    $('campo-bloqueio').innerHTML = '';
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
    if (pontosAlterados() && !estado.dadosGerais.justificativaPontos) avisos.push('Nº de pontos alterado sem justificativa.');
    if (!estado.tipo) avisos.push('Tipo de monitoramento não escolhido.');

    if (estado.tipo === 'ruido') {
      const faltandoEquip = categoriasEquipFaltando();
      if (faltandoEquip.length) avisos.push('Equipamentos: falta selecionar ' + faltandoEquip.join(', ') + '.');
      const pendentesPre = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo, opcoesRomaneio());
      if (pendentesPre > 0) avisos.push('Pré-campo com ' + pendentesPre + ' item(ns) obrigatório(s) não conferido(s).');

    }
    return avisos;
  }

  // Itens em branco do "Monitoramento em campo" que IMPEDEM o salvamento
  // (qualquer item, exceto hora de término). Só vale para o ruído por enquanto.
  function bloqueiosSalvar() {
    if (estado.tipo === 'ruido' && EC.campoRuido.itensFaltando) {
      return EC.campoRuido.itensFaltando(estado);
    }
    return [];
  }

  function renderizarRevisao() {
    const area = $('revisao-conteudo');
    let html = '';

    html += secaoRevisao('📄 Dados gerais',
      linhaResumo('Nº da OS', estado.os.numero) +
      linhaResumo('Cliente', estado.os.cliente) +
      linhaResumo('Endereço', estado.os.endereco) +
      linhaResumo('Campanha', servicoDetalhe('campanha')) +
      linhaResumo('Escopo', servicoDetalhe('escopo')) +
      linhaResumo('Início', formatarDataBR(estado.dadosGerais.dataInicio) + ' às ' + estado.dadosGerais.horaInicio) +
      linhaResumo('Pontos', estado.dadosGerais.qtdePontos + (pontosAlterados() ? ' (OS previa ' + estado.dadosGerais.qtdePontosOS + ')' : '')) +
      (pontosAlterados() ? linhaResumo('Justificativa dos pontos', estado.dadosGerais.justificativaPontos) : '') +
      linhaResumo('Dias de medição', estado.servico.dias) +
      linhaResumo('Período', servicoDetalhe('periodo')) +
      linhaResumo('Método', servicoDetalhe('metodo')) +
      linhaResumo('Observação', servicoDetalhe('observacao')) +
      linhaResumo('Link do Google Maps', estado.os.linkMaps),
      'tela-dados-gerais');

    html += secaoRevisao('🧭 Tipo de monitoramento', linhaResumo('Tipo', nomeTipo(estado.tipo)), 'tela-tipo');

    html += secaoRevisao('🔧 Equipamentos',
      linhaResumo('Selecionados', estado.equipamentos.length ? estado.equipamentos.join(', ') : '—'),
      'tela-passo3a');

    let resumoPre = '—';
    if (EC.romaneios.dados[estado.tipo]) {
      const pendentesPre = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo, opcoesRomaneio());
      resumoPre = pendentesPre === 0 ? '✓ itens obrigatórios conferidos' : 'falta(m) ' + pendentesPre + ' item(ns) obrigatório(s)';
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

    const bloqueios = bloqueiosSalvar();
    const avisos = avisosRevisao();
    if (bloqueios.length) {
      html += '<div class="alerta alerta-vermelho"><strong>🛑 Itens obrigatórios em branco no monitoramento em campo (impedem o salvamento):</strong><ul class="lista-avisos">' +
        bloqueios.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>';
    }
    if (avisos.length) {
      html += '<div class="alerta alerta-amarelo"><strong>⚠️ Outros itens em branco (não impedem o salvamento):</strong><ul class="lista-avisos">' +
        avisos.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>';
    }
    if (!bloqueios.length && !avisos.length) {
      html += '<div class="alerta alerta-info">✅ Tudo preenchido.</div>';
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
    const bloqueios = bloqueiosSalvar();
    const avisos = avisosRevisao();
    const btn = $('finalizar-salvar');
    let html = '';
    if (bloqueios.length) {
      html = '<div class="alerta alerta-vermelho"><strong>🛑 Não dá para salvar: há item(ns) obrigatório(s) em branco no monitoramento em campo.</strong><ul class="lista-avisos">' +
        bloqueios.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>';
      btn.disabled = true;
    } else {
      btn.disabled = false;
      if (avisos.length) html = '<div class="alerta alerta-amarelo">⚠️ ' + avisos.length + ' item(ns) em branco (não impedem o salvamento) — veja na Revisão.</div>';
    }
    $('finalizar-avisos').innerHTML = html;
  }

  function montarRegistro() {
    const sessao = EC.storage.ler('sessao:atual') || {};
    const agora = new Date();
    const tipoTexto = estado.campo && estado.campo.subtipo
      ? EC.campoRuido.TIPOS_CARIMBO[estado.campo.subtipo]
      : (estado.tipo || 'SEMTIPO').toUpperCase();
    return {
      codificacao: 'OS_' + estado.os.numero + '_' + tipoTexto + '_' + carimboDataHora(agora),
      servicoId: estado.servicoId,
      os: estado.os,
      servico: estado.servico,
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
    const bloqueios = bloqueiosSalvar();
    if (bloqueios.length) {
      EC.app.mostrarToast('Há item(ns) obrigatório(s) em branco no monitoramento em campo.');
      prepararFinalizar();
      return;
    }
    const registro = montarRegistro();
    if (!EC.storage.salvar('historico:' + registro.codificacao, registro)) {
      EC.app.mostrarToast('⚠️ Não foi possível salvar (memória do navegador cheia?).');
      return;
    }

    const historico = EC.storage.listar('historico:')
      .sort(function (a, b) { return (a.valor.salvoEm || '').localeCompare(b.valor.salvoEm || ''); });
    while (historico.length > 20) EC.storage.remover(historico.shift().chave);

    EC.storage.remover(chaveServico(estado.osNumero, estado.servicoIndice)); // rascunho do serviço concluído

    $('finalizar-area').classList.add('oculto');
    const area = $('sucesso-area');
    area.classList.remove('oculto');
    $('sucesso-resumo').innerHTML =
      linhaResumo('Registro', registro.codificacao) +
      linhaResumo('Cliente', registro.os.cliente) +
      linhaResumo('Escopo', registro.servico ? registro.servico.escopo : '') +
      linhaResumo('Técnico', registro.tecnico) +
      linhaResumo('Salvo em', new Date(registro.salvoEm).toLocaleString('pt-BR'));

    // botão para voltar aos demais serviços da OS (só quando há vários)
    $('sucesso-servicos').classList.toggle('oculto', !multiServico);

    estado = null;
    if (EC.app.atualizarBarraPendencias) EC.app.atualizarBarraPendencias();
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
    $('servicos-os-voltar').addEventListener('click', function () {
      renderizarListaOs();
      EC.app.mostrarTela('tela-os');
    });

    montarNavegacao('tela-dados-gerais', {
      aoVoltar: voltarDoServico,
      aoProximo: function () {
        coletarDadosGerais();
        if (pontosAlterados() && !estado.dadosGerais.justificativaPontos) {
          EC.app.mostrarToast('Você alterou o nº de pontos — preencha a justificativa.');
          atualizarJustificativaPontos();
          $('dg-justificativa').focus();
          return;
        }
        irPara('tela-tipo');
      }
    });
    montarNavegacao('tela-tipo', {
      aoProximo: function () {
        if (!estado.tipo) { EC.app.mostrarToast('Escolha um tipo de monitoramento para continuar.'); return; }
        irPara('tela-passo3a');
      }
    });
    montarNavegacao('tela-passo3a', {
      aoProximo: function () {
        const faltando = categoriasEquipFaltando();
        if (faltando.length) {
          EC.app.mostrarToast('Selecione ao menos um equipamento de: ' + faltando.join(', ') + '.');
          return;
        }
        irPara('tela-passo3b');
      }
    });
    montarNavegacao('tela-passo3b', {
      aoProximo: function () {
        const pendentes = EC.romaneios.pendentesObrigatorios(estado.tipo, estado.preCampo, opcoesRomaneio());
        if (pendentes > 0) {
          EC.app.mostrarToast('Conclua o pré-campo: falta(m) ' + pendentes + ' item(ns) obrigatório(s).');
          return;
        }
        irPara('tela-checkpoint');
      }
    });
    // DEV: marcar todos os itens do pré-campo de uma vez — REMOVER antes de produção
    $('precampo-marcar-tudo').addEventListener('click', function () {
      document.querySelectorAll('#precampo-conteudo input[data-chave]').forEach(function (cb) {
        if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      });
    });
    $('checkpoint-ir').addEventListener('click', function () { irPara('tela-passo4'); });
    $('checkpoint-voltar').addEventListener('click', function () { irPara('tela-passo3b'); });
    montarNavegacao('tela-passo4', {
      aoVoltar: function () { irPara('tela-passo3b'); },
      aoProximo: function () {
        const faltando = bloqueiosSalvar();
        if (faltando.length) {
          $('campo-bloqueio').innerHTML =
            '<div class="alerta alerta-vermelho"><strong>🛑 Não é possível continuar — itens obrigatórios em branco no monitoramento em campo:</strong>' +
            '<ul class="lista-avisos">' + faltando.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>';
          $('campo-bloqueio').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
        $('campo-bloqueio').innerHTML = '';
        irPara('tela-revisao');
      }
    });
    montarNavegacao('tela-revisao');
    montarNavegacao('tela-passo5', { aoProximo: null });

    $('finalizar-salvar').addEventListener('click', salvarRegistro);
    $('finalizar-novo').addEventListener('click', function () {
      estado = null;
      EC.app.mostrarTela('tela-acao');
    });
    $('sucesso-novo').addEventListener('click', function () { EC.app.mostrarTela('tela-acao'); });
    $('sucesso-servicos').addEventListener('click', function () {
      renderizarServicos(osAtual);
      EC.app.mostrarTela('tela-servicos-os');
    });
    $('sucesso-pdf').addEventListener('click', function () {
      EC.app.mostrarToast('A geração de PDF entra na Fase 3.');
    });
  }

  let telasIniciadas = false;

  function iniciar() {
    if (!telasIniciadas) { telasIniciadas = true; inicializarTelas(); }
    renderizarListaOs();
    EC.app.mostrarTela('tela-os');
  }

  return { iniciar: iniciar };
})();
