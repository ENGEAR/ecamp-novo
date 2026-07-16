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
    { id: 'ruido', icone: '🔊', img: 'Ruído.jpeg', nome: 'Ruído' },
    { id: 'sismo', icone: '🌍', img: 'Vibração.jpeg', nome: 'Vibração' },
    { id: 'qar', icone: '💨', img: 'QAR Externo.jpeg', nome: 'QAR Externo' },
    { id: 'opacidade', icone: '👁', img: 'opacidade.jpeg', nome: 'Opacidade' },
    { id: 'qarint', icone: '🏠', img: 'QAR Interno.jpeg', nome: 'QAR Interno' },
    { id: 'outro', icone: '📋', img: 'Outro.png', nome: 'Outro' }
  ];

  let estado = null;       // estado do serviço aberto no momento
  let osAtual = null;      // objeto da OS em trabalho
  let multiServico = false;
  let telaExibida = null;
  let ultimoRegistroPdf = null; // registro recém-finalizado (COM fotos) p/ gerar o PDF

  // Trava de edição do rascunho colaborativo (um técnico por serviço de cada vez).
  let travaTimer = null;   // heartbeat que renova a trava enquanto edita
  let travaAtual = null;   // { os, servico } do serviço travado agora
  const TRAVA_RENOVA_MS = 4 * 60 * 1000; // renova a cada 4 min (servidor expira em 8)

  // Adquire a trava do serviço e liga o heartbeat. Best-effort (offline não trava).
  function iniciarTravaEdicao(numeroOs, servico) {
    pararTravaEdicao(); // solta a anterior antes de assumir outra
    if (!(EC.sync && EC.sync.travar)) return;
    travaAtual = { os: numeroOs, servico: servico };
    EC.sync.travar(numeroOs, servico, true); // já entrou no serviço → assume a trava
    travaTimer = setInterval(function () {
      if (!travaAtual || !EC.sync.renovarTrava) return;
      EC.sync.renovarTrava(travaAtual.os, travaAtual.servico).then(function (r) {
        // Outro técnico assumiu o serviço enquanto eu editava → aviso (sem travar a tela).
        if (r && r.bloqueada) EC.app.mostrarToast('⚠️ Outro técnico assumiu este serviço. Salve com cuidado — pode haver conflito.');
      });
    }, TRAVA_RENOVA_MS);
  }
  // Libera a trava do serviço atual e desliga o heartbeat.
  function pararTravaEdicao() {
    if (travaTimer) { clearInterval(travaTimer); travaTimer = null; }
    if (travaAtual && EC.sync && EC.sync.liberarTrava) EC.sync.liberarTrava(travaAtual.os, travaAtual.servico);
    travaAtual = null;
  }
  // Ao fechar/atualizar a aba, solta a trava (keepalive p/ dar tempo de sair).
  window.addEventListener('pagehide', function () {
    if (travaAtual && EC.sync && EC.sync.liberarTrava) EC.sync.liberarTrava(travaAtual.os, travaAtual.servico);
  });

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

  // Município/UF derivado do endereço (parte após o último "—")
  function municipioUF(endereco) {
    if (!endereco) return '';
    const partes = String(endereco).split('—');
    return partes.length > 1 ? partes[partes.length - 1].trim() : '';
  }
  function codigoOs(numero) { return 'ENGTC_' + numero + '_R.0'; }
  function contarCampanhas(os) {
    const set = {};
    (os.servicos || []).forEach(function (s) { set[s.campanha || '—'] = true; });
    return Object.keys(set).length;
  }

  // Id estável do rascunho deste serviço. DETERMINÍSTICO por OS+serviço para que
  // TODOS os aparelhos da equipe salvem na MESMA linha do servidor (rascunho
  // colaborativo — continuar o serviço de outro técnico). Rascunhos antigos com
  // id aleatório seguem funcionando; e ao continuar um do servidor, o app adota
  // o rascunhoId de lá (ver aoTocarServico).
  function gerarRascunhoId(numeroOs, indice) {
    return 'rasc-' + servicoId(numeroOs, indice);
  }

  function novoEstadoServico(os, indice) {
    const agora = new Date();
    const servico = os.servicos[indice];
    return {
      osNumero: os.numero,
      servicoIndice: indice,
      servicoId: servicoId(os.numero, indice),
      rascunhoId: gerarRascunhoId(os.numero, indice),
      os: {
        numero: os.numero,
        osId: os.osId || null,   // uuid da ordens_servico (p/ buscar os detalhes completos)
        codigo: codigoOs(os.numero),
        projeto: os.projeto || '',
        emitidoPor: os.emitidoPor || '',
        dataEmissao: os.dataEmissao || '',
        cliente: os.cliente,
        cnpjCpf: os.cnpjCpf || '',
        endereco: os.endereco,
        municipioUF: municipioUF(os.endereco),
        contato: os.contato || '',
        resumo: os.resumo,
        frequencia: os.frequencia || '',
        rota: os.rota || '',
        numCampanhas: contarCampanhas(os),
        observacao: os.observacao,
        linkMaps: os.linkMaps || ''
      },
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
      iniciado: false, // vira true ao avançar da 1ª tela ou salvar rascunho
      atualizadoEm: agora.toISOString()
    };
  }

  function salvarEstado() {
    if (!estado) return false;
    // Só marca a OS como "em andamento" (grava rascunho) DEPOIS que o técnico
    // realmente começa: avançar da 1ª tela ou tocar em "Salvar rascunho" liga
    // `estado.iniciado`. Assim, abrir uma OS por engano e voltar NÃO deixa rastro.
    if (!estado.iniciado) return false;
    estado.atualizadoEm = new Date().toISOString();
    var chave = chaveServico(estado.osNumero, estado.servicoIndice);
    // Rascunho COMPLETO (com fotos) no IndexedDB — aguenta o tamanho e permite
    // continuar offline depois sem perder as fotos.
    if (EC.db) EC.db.set('rascunhos', chave, estado).catch(function () { /* ok */ });
    // Versão LEVE no localStorage (status na lista de serviços + restauração
    // básica), SEM fotos, para não estourar a memória. semFotos() está abaixo.
    return EC.storage.salvar(chave, semFotos(estado));
  }

  function servicoDetalhe(campo) {
    return (estado.servico && estado.servico[campo]) || '';
  }

  /* ---------- Navegação ---------- */

  function irPara(idTela) {
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();
    if (estado) {
      estado.passoAtual = idTela;
      // Sair da 1ª tela para qualquer outra = o técnico começou de fato.
      if (idTela !== 'tela-dados-gerais') estado.iniciado = true;
      salvarEstado();
    }

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

  // Auto-envio LEVE (só os dados, sem fotos) ao AVANÇAR de tela: mantém o
  // SharePoint em dia com o que já foi preenchido, sem depender do botão "Salvar
  // rascunho". As fotos sobem no "Salvar rascunho"/Finalizar. Silencioso e
  // best-effort — se falhar por rede, o rascunho vai para a fila e sobe sozinho
  // depois (ver EC.sync.sincronizarRascunhoDados). Só dispara com tipo já
  // escolhido (antes disso o servidor não tem como criar a linha Incompleto).
  function autoPushDados() {
    if (!estado || !estado.iniciado || !estado.tipo) return;
    if (!(EC.sync && EC.sync.sincronizarRascunhoDados)) return;
    var registro = montarRegistro();
    registro.finalizar = false;
    EC.sync.sincronizarRascunhoDados(registro);
  }

  // Sair do primeiro passo do serviço: volta à lista de serviços (OS com vários)
  // ou à lista de OS (OS com um único serviço).
  function voltarDoServico() {
    if (estado && telaExibida === 'tela-dados-gerais') { coletarDadosGerais(); salvarEstado(); }
    pararTravaEdicao(); // saiu do serviço → libera a trava para a equipe
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

  function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

  // Tag "Em andamento · Fulano" — quem está preenchendo a OS (do servidor, então
  // vale para qualquer aparelho da equipe). Só mostra OUTRAS pessoas: quando sou
  // EU que estou com a OS, a tag some (o "em andamento" do meu próprio aparelho
  // já me avisa). Vazia se ninguém além de mim está com ela.
  function tagTecnicoOs(os) {
    const nomes = (EC.os && EC.os.andamentoPor) ? EC.os.andamentoPor(os.numero) : [];
    if (!nomes.length) return '';
    const eu = ((EC.storage.ler('sessao:atual') || {}).nome || '').trim().toLowerCase();
    const outros = nomes.filter(function (n) { return (n || '').trim().toLowerCase() !== eu; });
    if (!outros.length) return '';
    const primeiros = outros.map(primeiroNome).filter(Boolean);
    const texto = primeiros.slice(0, 2).join(', ') + (primeiros.length > 2 ? ' +' + (primeiros.length - 2) : '');
    return '<span class="os-tag-tecnico">⏳ Em andamento · ' + texto + '</span>';
  }

  // HTML de um cartão de OS (usado nas três seções). Carrega o número da OS no
  // dataset para localizar o objeto no clique (sem depender de índice de array).
  function cartaoOs(os) {
    const r = resumoServicosOs(os);
    let badge = '';
    // "em andamento" = SÓ quando há rascunho ATIVO. Se tem serviço concluído mas
    // nenhum rascunho ativo (ex.: desistiu do resto), é "Parcial — X de Y", não
    // "em andamento" (senão a OS ficava presa em "em andamento" pelos concluídos).
    if (r.total && r.concluidos === r.total) badge = ' <span class="os-andamento status-concluido">✅ concluída</span>';
    else if (r.andamento > 0) badge = ' <span class="os-andamento">⏸️ em andamento</span>';
    else if (r.concluidos > 0) badge = ' <span class="os-andamento os-parcial">Parcial — ' + r.concluidos + ' de ' + r.total + '</span>';
    const linhaServicos = r.total > 1
      ? '<span class="os-resumo">' + r.total + ' serviços' + (r.concluidos ? ' · ' + r.concluidos + ' concluído(s)' : '') + '</span>'
      : '';
    return (
      '<button type="button" class="os-item" data-numero="' + os.numero + '">' +
      '  <span class="os-numero">OS ' + os.numero + badge + '</span>' +
      tagTecnicoOs(os) +
      '  <span class="os-cliente">' + os.cliente + '</span>' +
      (os.projeto ? '  <span class="os-projeto">📁 ' + os.projeto + '</span>' : '') +
      (os.resumo ? '  <span class="os-resumo">' + os.resumo + '</span>' : '') +
      linhaServicos +
      '</button>'
    );
  }

  function ligarCliquesOs(container) {
    container.querySelectorAll('.os-item[data-numero]').forEach(function (item) {
      item.addEventListener('click', function () {
        const os = EC.os.osPorNumero(item.dataset.numero);
        if (os) selecionarOs(os);
      });
    });
  }

  function ehLogisticaOuAdmin() {
    const p = (EC.storage.ler('sessao:atual') || {}).papeis || [];
    return p.indexOf('logistica') !== -1 || p.indexOf('admin') !== -1;
  }

  // Cartão da seção "Em andamento": SEM botão de arquivar no app. Arquivar um
  // rascunho preso ficou SÓ no SGP (tela Campo — em andamento, atrás do login),
  // para ninguém tocar sem querer no celular e tirar de andamento um estudo que
  // outro técnico está fazendo agora.
  function cartaoOsAndamento(os) {
    return cartaoOs(os);
  }

  // Sem botão no app → nada a ligar. Mantida por compatibilidade (chamadores).
  function ligarLimparAndamento() { /* arquivar agora é só no SGP */ }

  // Filtro de escopo: logística vê tudo; os demais só as OS escaladas na agenda.
  function noEscopo(os) { return !EC.os || !EC.os.dentroEscopo || EC.os.dentroEscopo(os); }
  function restrito() { return !!(EC.os && EC.os.escopoAtual && !EC.os.escopoAtual().tudo); }
  // Mensagem de "nada aqui" sensível ao escopo do usuário.
  function vazioOs() {
    return restrito()
      ? '<p class="texto-apoio">Você não tem OS escaladas na agenda. Fale com a logística para ser incluído no serviço.</p>'
      : '<p class="texto-apoio">Nenhuma OS disponível. Conecte à internet para baixar as OS.</p>';
  }

  // Pinta a tela de OS: com termo de busca, mostra só os resultados; sem termo,
  // mostra "Em andamento" (do servidor, compartilhada) + "Recentes" (deste
  // aparelho) + "Todas as OS" (ou "Minhas OS", se o usuário for restrito).
  function pintarOs(termo) {
    termo = termo || '';
    const blocoAnd = $('os-andamento-bloco');
    const blocoRec = $('os-recentes-bloco');
    const tituloTodas = $('os-todas-titulo');
    const listaTodas = $('lista-os');

    if (termo.trim()) {
      if (blocoAnd) blocoAnd.classList.add('oculto');
      if (blocoRec) blocoRec.classList.add('oculto');
      const resultados = EC.os.buscar(termo).filter(noEscopo);
      if (tituloTodas) tituloTodas.textContent = resultados.length + ' resultado(s)';
      listaTodas.innerHTML = resultados.length
        ? resultados.map(cartaoOs).join('')
        : '<p class="texto-apoio">Nenhuma OS encontrada.</p>';
      ligarCliquesOs(listaTodas);
      return;
    }

    const todas = EC.os.lista().filter(noEscopo);
    const numsAndamento = EC.os.andamento();
    const numsRecentes = EC.os.recentes();

    // Em andamento (as que começaram o serviço no servidor)
    const emAndamento = todas.filter(function (os) { return numsAndamento.indexOf(os.numero) !== -1; });
    if (blocoAnd) {
      if (emAndamento.length) {
        $('os-andamento').innerHTML = emAndamento.map(cartaoOsAndamento).join('');
        ligarCliquesOs($('os-andamento'));
        ligarLimparAndamento($('os-andamento'));
        blocoAnd.classList.remove('oculto');
      } else { blocoAnd.classList.add('oculto'); }
    }

    // Recentes (deste aparelho), na ordem de recência, sem repetir as em andamento
    const recentes = [];
    numsRecentes.forEach(function (n) {
      const os = EC.os.osPorNumero(n);
      if (os && numsAndamento.indexOf(n) === -1 && noEscopo(os)) recentes.push(os);
    });
    if (blocoRec) {
      if (recentes.length) {
        $('os-recentes').innerHTML = recentes.map(cartaoOs).join('');
        ligarCliquesOs($('os-recentes'));
        blocoRec.classList.remove('oculto');
      } else { blocoRec.classList.add('oculto'); }
    }

    // Todas (ou "Minhas OS", para o usuário restrito ao que está na agenda)
    if (tituloTodas) tituloTodas.textContent = (restrito() ? 'Minhas OS (' : 'Todas as OS (') + todas.length + ')';
    listaTodas.innerHTML = todas.length
      ? todas.map(cartaoOs).join('')
      : vazioOs();
    ligarCliquesOs(listaTodas);
  }

  let buscaLigada = false;
  function renderizarListaOs() {
    const input = $('os-busca');
    if (input && !buscaLigada) {
      buscaLigada = true;
      input.addEventListener('input', function () { pintarOs(input.value); });
    }
    if (input) input.value = '';
    pintarOs('');
  }

  function selecionarOs(os) {
    if (EC.os && EC.os.marcarRecente) EC.os.marcarRecente(os.numero);
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
          '<button type="button" class="os-item servico-item" data-indice="' + o.i + '"' +
          ' data-servicoid="' + escDg(servicoId(os.numero, o.i)) + '" data-escopo="' + escDg(o.s.escopo) + '"' +
          ' data-situacao="' + st + '">' +
          '  <span class="os-numero">▶️ ' + o.s.escopo + '</span>' + info +
          '  ' + SELO[st] +
          '  <span class="servico-tag-servidor"></span>' +
          '</button>'
        );
      }).join('');

      campanhaAnterior = campanha;
      if (!todasConcluidas) liberada = false; // próximas campanhas ficam travadas
    });
    lista.innerHTML = html;
    // Marca (tag roxa "Continuar de Fulano") os serviços que a EQUIPE já começou
    // no servidor — sem esperar o técnico entrar no escopo.
    pintarRascunhosServidor(os);

    lista.querySelectorAll('.servico-item[data-indice]').forEach(function (item) {
      item.addEventListener('click', function () {
        aoTocarServico(os, parseInt(item.dataset.indice, 10));
      });
    });
  }

  // Pinta a tag roxa "Continuar de Fulano" nos serviços que a EQUIPE já começou
  // (rascunho no servidor). Casa por servicoId exato; rascunho antigo sem
  // servicoId cai no escopo. Não pinta serviço já concluído no aparelho.
  async function pintarRascunhosServidor(os) {
    if (!navigator.onLine || !(EC.sync && EC.sync.listarRascunhos)) return;
    var rascunhos = [];
    try { rascunhos = await EC.sync.listarRascunhos(os.numero); } catch (e) { return; }
    if (!rascunhos.length) return;
    var porServico = {}, porEscopo = {};
    rascunhos.forEach(function (r) {
      if (r.servicoId) { if (!porServico[r.servicoId]) porServico[r.servicoId] = r; }
      else if (r.escopo && !porEscopo[r.escopo]) porEscopo[r.escopo] = r; // só rascunho antigo sem servicoId
    });
    var sessao = EC.storage.ler('sessao:atual') || {};
    var lista = $('lista-servicos');
    if (!lista) return;
    lista.querySelectorAll('.servico-item[data-indice]').forEach(function (item) {
      if (item.dataset.situacao === 'concluido') return; // concluído aqui: não marca
      var r = porServico[item.dataset.servicoid] || porEscopo[item.dataset.escopo];
      if (!r) return;
      var alvo = item.querySelector('.servico-tag-servidor');
      if (!alvo) return;
      var souEu = !!(r.tecnico && sessao.nome && r.tecnico === sessao.nome);
      var primeiro = (r.tecnico || '').trim().split(/\s+/)[0] || 'equipe';
      alvo.className = 'servico-status status-continuar';
      alvo.textContent = souEu ? '▶️ Continuar (você)' : '▶️ Continuar de ' + primeiro;
    });
  }

  // A trava do lock é minha? (comparando pelo e-mail da sessão)
  function minhaTrava(lock) {
    var sessao = (EC.storage && EC.storage.ler('sessao:atual')) || {};
    return !!(lock && lock.email && sessao.email && lock.email === sessao.email);
  }

  // Overlay "continuar do servidor": este serviço foi começado por outro técnico
  // em outro aparelho. Puxa os DADOS (sem as fotos dele) e adota o rascunhoId de
  // lá, para salvar na MESMA linha do servidor.
  function oferecerContinuarDoServidor(os, indice, servidor) {
    const escopo = os.servicos[indice].escopo;
    const r = servidor.rascunho;
    const lock = servidor.lock;
    const quem = r.tecnico || 'outro técnico';
    const quando = r.atualizadoEm ? new Date(r.atualizadoEm).toLocaleString('pt-BR') : '';
    const travadoPorOutro = !!(lock && !lock.expirada && !minhaTrava(lock));

    var corpo = '<p>Este serviço já foi começado por <strong>' + escDg(quem) + '</strong>' +
      (quando ? ' (último salvamento: ' + quando + ')' : '') + ', em outro aparelho.</p>' +
      '<p class="texto-apoio">📷 As fotos que ' + escDg(quem) + ' tirou ficam no aparelho dele — tire as suas normalmente; elas se juntam no servidor ao finalizar.</p>';
    if (travadoPorOutro) {
      corpo += '<div class="alerta alerta-amarelo">🔒 ' + escDg(lock.tecnico || quem) + ' está preenchendo agora. Se assumir, o que ele estiver digitando pode se perder.</div>' +
        '<div class="pilha-botoes">' +
        '  <button type="button" class="botao botao-perigo" id="sv-assumir">Assumir mesmo assim</button>' +
        '  <button type="button" class="botao botao-secundario" id="sv-cancelar">Cancelar</button>' +
        '</div>';
    } else {
      corpo += '<div class="pilha-botoes">' +
        '  <button type="button" class="botao botao-primario" id="sv-continuar-serv">✏️ Continuar preenchimento</button>' +
        '  <button type="button" class="botao botao-secundario" id="sv-cancelar">Cancelar</button>' +
        '</div>';
    }
    EC.app.abrirOverlay(escopo, corpo);

    function continuar() {
      EC.app.fecharOverlay();
      var estadoServidor = r.estado || {};
      // adota o id do servidor → salva na MESMA linha (upsert)
      estadoServidor.rascunhoId = r.rascunhoId || estadoServidor.rascunhoId;
      estadoServidor.continuadoDoServidor = true; // marca: fotos de outro técnico ausentes aqui
      abrirServico(os, indice, estadoServidor); // já assume a trava (força) e salva local
      EC.app.mostrarToast('✏️ Continuando o serviço começado por ' + quem + '.');
    }
    if (travadoPorOutro) $('sv-assumir').addEventListener('click', continuar);
    else $('sv-continuar-serv').addEventListener('click', continuar);
    $('sv-cancelar').addEventListener('click', EC.app.fecharOverlay);
  }

  // Decide se abre direto, ou pergunta (continuar/reiniciar/refazer).
  async function aoTocarServico(os, indice) {
    osAtual = os;
    multiServico = os.servicos.length > 1;
    const rascunho = EC.storage.ler(chaveServico(os.numero, indice));
    const registro = registroDoServico(os.numero, indice);
    const escopo = os.servicos[indice].escopo;

    // Rascunho da EQUIPE no servidor (colaborativo). Consulta se online.
    var servidor = null, falhouServidor = false;
    if (navigator.onLine && EC.sync && EC.sync.buscarRascunho) {
      try { servidor = await EC.sync.buscarRascunho(os.numero, escopo, servicoId(os.numero, indice)); }
      catch (e) { falhouServidor = true; }
    }
    var rascServidor = (servidor && servidor.rascunho && servidor.rascunho.estado) ? servidor.rascunho : null;

    // SEGURANÇA (incidente 2026-07-15): um rascunho LOCAL NUNCA é substituído
    // automaticamente pelo do servidor — a versão do servidor pode ser MAIS POBRE
    // (outro técnico abriu e salvou vazio) e apagaria o trabalho do técnico. Só
    // puxamos do servidor quando NÃO há rascunho local aqui. Se há local, ele
    // manda; para trocar pela versão da equipe, o técnico usa "Reiniciar".
    if (!rascunho && rascServidor) {
      oferecerContinuarDoServidor(os, indice, servidor);
      return;
    }

    if (rascunho) {
      EC.app.abrirOverlay(escopo,
        '<p>Este serviço já tinha começado a ser preenchido' +
        (rascunho.atualizadoEm ? ' (último salvamento: ' + new Date(rascunho.atualizadoEm).toLocaleString('pt-BR') + ')' : '') +
        '. O que você quer fazer?</p>' +
        '<div class="pilha-botoes">' +
        '  <button type="button" class="botao botao-primario" id="sv-continuar">✏️ Continuar preenchimento</button>' +
        '  <button type="button" class="botao botao-secundario" id="sv-reiniciar">🔄 Reiniciar este serviço</button>' +
        '  <button type="button" class="botao botao-perigo" id="sv-descartar">🗑️ Descartar (não vou fazer)</button>' +
        '</div>');
      $('sv-continuar').addEventListener('click', async function () {
        EC.app.fecharOverlay();
        var completo = rascunho;
        if (EC.db) {
          try {
            var full = await EC.db.get('rascunhos', chaveServico(os.numero, indice));
            if (full) completo = full; // versão com as fotos
          } catch (e) { /* usa o rascunho leve */ }
        }
        abrirServico(os, indice, completo);
      });
      $('sv-reiniciar').addEventListener('click', function () {
        EC.app.fecharOverlay();
        EC.storage.remover(chaveServico(os.numero, indice));
        if (EC.db) EC.db.remove('rascunhos', chaveServico(os.numero, indice)).catch(function () {});
        // Re-avalia SEM o local: se a equipe tem rascunho no servidor, oferece
        // continuar dele (em vez de criar um vazio novo, que duplicaria a linha).
        aoTocarServico(os, indice);
      });
      $('sv-descartar').addEventListener('click', function () {
        if (!confirm('Descartar este serviço? Isso apaga o que foi preenchido nele e ele sai de "em andamento". Não dá para desfazer.')) return;
        EC.app.fecharOverlay();
        descartarServico(os, indice, rascunho);
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

    // Online mas a checagem do servidor falhou → avisa (não abre calado, senão o
    // técnico perde o rascunho da equipe sem saber que houve erro de rede).
    if (falhouServidor) {
      EC.app.mostrarToast('Não consegui verificar se a equipe já começou este serviço (sinal?). Se for continuar de outro técnico, tente abrir de novo.');
    }
    abrirServico(os, indice, null);
  }

  // Descarta um serviço aberto por engano: apaga o rascunho local, tira dos
  // "recentes" e, se já tinha ido pro servidor como Incompleto, apaga lá também.
  // Depois volta e atualiza a lista para a OS sair de "em andamento".
  function descartarServico(os, indice, rascunho) {
    const chave = chaveServico(os.numero, indice);
    pararTravaEdicao(); // some de "em andamento" → libera a trava do serviço
    EC.storage.remover(chave);
    if (EC.db) EC.db.remove('rascunhos', chave).catch(function () { /* ok */ });
    if (EC.os && EC.os.esquecerRecente) EC.os.esquecerRecente(os.numero);
    // Tira a OS de "em andamento" JÁ (seção + tag "Em andamento · Fulano"), sem
    // esperar o servidor — assim a tag some na hora, inclusive offline.
    if (EC.os && EC.os.esquecerAndamento) EC.os.esquecerAndamento(os.numero);

    function repintarOs() {
      const input = $('os-busca');
      if (input && !input.value.trim() && !$('tela-os').classList.contains('oculto')) pintarOs('');
    }

    const rid = rascunho && rascunho.rascunhoId;
    if (rid && EC.sync && EC.sync.descartarRascunho) {
      EC.sync.descartarRascunho(rid).then(function () {
        // servidor atualizado → re-sincroniza a lista/seção E a tag de "em andamento"
        if (EC.os && EC.os.carregar) EC.os.carregar(repintarOs);
        if (EC.os && EC.os.carregarAndamentoPor) EC.os.carregarAndamentoPor().then(repintarOs);
      });
    }

    EC.app.mostrarToast('🗑️ Serviço descartado.');
    estado = null;
    telaExibida = null;
    if (os.servicos.length > 1) {
      renderizarServicos(os);
      EC.app.mostrarTela('tela-servicos-os');
    } else {
      renderizarListaOs();
      EC.app.mostrarTela('tela-os');
    }
  }

  function abrirServico(os, indice, rascunhoExistente) {
    telaExibida = null; // entrando em serviço novo: não coletar da tela anterior
    estado = rascunhoExistente || novoEstadoServico(os, indice);
    // Rascunho que já existia = já foi iniciado antes (mantém salvando ao navegar).
    if (rascunhoExistente) estado.iniciado = true;
    // reidrata os dados de referência da OS/serviço (reflete a OS atual e
    // preenche campos novos em rascunhos antigos)
    const fresh = novoEstadoServico(os, indice);
    estado.os = fresh.os;
    estado.servico = fresh.servico;
    if (estado.dadosGerais.qtdePontosOS === undefined) estado.dadosGerais.qtdePontosOS = os.servicos[indice].qtdePontos;
    if (estado.dadosGerais.justificativaPontos === undefined) estado.dadosGerais.justificativaPontos = '';
    salvarEstado();
    // Entrou no serviço → assume a trava de edição (rascunho colaborativo).
    iniciarTravaEdicao(os.numero, servicoId(os.numero, indice));
    irPara(estado.passoAtual || 'tela-dados-gerais');
  }

  /* ---------- Dados gerais ---------- */

  // Escape de HTML — os valores da OS entram no innerHTML da tela.
  function escDg(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Campo de LEITURA que QUEBRA LINHA (rótulo em cima, valor embaixo). Resolve o
  // texto grande "indo para a direita": tudo fica visível dentro da tela.
  function dgCampo(rotulo, valor) {
    var v = (valor === undefined || valor === null || String(valor).trim() === '') ? '—' : valor;
    return '<div class="dg-campo"><span class="dg-rot">' + escDg(rotulo) + '</span>' +
      '<span class="dg-val">' + escDg(String(v)) + '</span></div>';
  }
  function dgGrade2(a, b) { return '<div class="grade-2">' + a + b + '</div>'; }
  function dgSecao(t) { return '<p class="dg-secao">' + escDg(t) + '</p>'; }
  function juntar(arr, sep) { return (arr || []).filter(Boolean).join(sep || ', '); }

  function preencherDadosGerais() {
    const o = estado.os;
    const dg = estado.dadosGerais;
    const dataEmissao = o.dataEmissao ? formatarDataBR(o.dataEmissao) : '—';

    // Campos de LEITURA quebram linha (dgCampo); os EDITÁVEIS (link do Maps,
    // pontos, justificativa) seguem como <input>/<textarea> com os MESMOS ids —
    // coletarDadosGerais continua lendo por id. Placeholders (<div id=…>) recebem
    // as seções ricas quando os detalhes completos da OS chegam.
    var html =
      dgSecao('Ordem de serviço') +
      dgGrade2(dgCampo('Nº da OS', o.numero), dgCampo('Código', o.codigo)) +
      dgCampo('Nome do projeto', o.projeto) +
      dgGrade2(dgCampo('Emitido por', o.emitidoPor), dgCampo('Data de emissão', dataEmissao)) +

      dgSecao('Cliente (contratante)') +
      dgCampo('Razão social', o.cliente) +
      dgGrade2(dgCampo('CNPJ / CPF', o.cnpjCpf), dgCampo('Contato', o.contato)) +
      dgCampo('Endereço', o.endereco) +
      dgCampo('Município / UF', o.municipioUF) +

      dgSecao('Local do serviço') +
      '<div id="dg-local-extra">' + dgCampo('Endereço', o.endereco) + dgCampo('Município / UF', o.municipioUF) + '</div>' +
      '<label>Local do monitoramento — link do Google Maps' +
        '<input type="text" id="dg-maps" placeholder="Cole o link do Google Maps" value="' + escDg(o.linkMaps || '') + '"></label>' +

      dgSecao('Serviço') +
      dgCampo('Serviço', o.resumo) +
      '<div id="dg-descricao"></div>' +
      dgGrade2(dgCampo('Frequência', o.frequencia), dgCampo('Rota', o.rota)) +
      dgCampo('Nº de campanhas', o.numCampanhas) +
      '<div id="dg-origem-destino"></div>' +

      dgSecao('Escopo deste serviço') +
      dgCampo('Campanha', servicoDetalhe('campanha')) +
      dgCampo('Escopo', servicoDetalhe('escopo')) +
      '<div class="grade-2">' +
        '<label>Pontos <span class="rotulo-apoio">(previsto na OS: ' + escDg(dg.qtdePontosOS) + ')</span>' +
          '<input type="number" id="dg-pontos" min="1" max="50" inputmode="numeric" value="' + escDg(dg.qtdePontos) + '"></label>' +
        dgCampo('Dias de medição', estado.servico.dias) +
      '</div>' +
      '<div id="dg-justificativa-bloco" class="' + (pontosAlterados() ? '' : 'oculto') + '">' +
        '<label>Justificativa da alteração do nº de pontos' +
          '<textarea id="dg-justificativa" rows="2" placeholder="Explique por que o nº de pontos ficou diferente do previsto na OS">' + escDg(dg.justificativaPontos || '') + '</textarea>' +
        '</label>' +
      '</div>' +
      dgCampo('Período', servicoDetalhe('periodo')) +
      dgCampo('Método', servicoDetalhe('metodo')) +
      dgCampo('Observação do escopo', servicoDetalhe('observacao')) +

      '<div id="dg-metodologia"></div>' +
      '<div id="dg-campanhas"></div>' +

      dgSecao('Informações relevantes') +
      dgCampo('Informações relevantes', o.observacao) +

      '<div id="dg-fotos"></div>' +

      dgSecao('Preenchimento') +
      dgGrade2(dgCampo('Data de início', formatarDataBR(dg.dataInicio)), dgCampo('Hora de início', dg.horaInicio));

    $('dg-corpo').innerHTML = html;

    // Eventos dos campos editáveis (mesmos ids → coletarDadosGerais segue igual).
    $('dg-pontos').oninput = function () {
      estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.dadosGerais.qtdePontos;
      atualizarJustificativaPontos();
      salvarEstado();
    };
    $('dg-justificativa').oninput = function () {
      estado.dadosGerais.justificativaPontos = $('dg-justificativa').value;
      salvarEstado();
    };
    // Link do Maps: único campo editável do bloco (os demais vêm fixos da OS).
    $('dg-maps').oninput = function () {
      estado.os.linkMaps = $('dg-maps').value;
      salvarEstado();
    };
    atualizarJustificativaPontos();

    // Detalhes completos da OS (descrição, campanhas, metodologia, origem/destino,
    // local) — do jsonb ordens_servico.detalhes, lido pela sessão (app-only).
    preencherDetalhesOS(o);
    // Fotos da OS (Análise Crítica) — URLs assinadas do servidor (online).
    preencherFotosOS(o);
  }

  // Busca as fotos da OS no servidor e monta a grade de miniaturas (toque amplia).
  function preencherFotosOS(o) {
    var el = $('dg-fotos');
    if (!el || !o.osId || !EC.os || !EC.os.carregarFotos) return;
    el.innerHTML = dgSecao('Fotos da OS') + '<p class="texto-apoio">⏳ Carregando fotos…</p>';
    EC.os.carregarFotos(o.osId).then(function (fotos) {
      // Só aplica se ainda estamos nesta OS/tela.
      if (!(telaExibida === 'tela-dados-gerais' && estado && estado.os && estado.os.osId === o.osId)) return;
      if (!fotos.length) {
        el.innerHTML = dgSecao('Fotos da OS') + '<p class="texto-apoio">' +
          (navigator.onLine ? 'Esta OS não tem fotos.' : '📡 Conecte-se para ver as fotos da OS.') + '</p>';
        return;
      }
      el.innerHTML = dgSecao('Fotos da OS') +
        '<div class="dg-fotos-grade">' +
        fotos.map(function (f) {
          return '<a class="dg-foto" href="' + escDg(f.url) + '" target="_blank" rel="noopener">' +
            '<img loading="lazy" src="' + escDg(f.url) + '" alt="Foto da OS"></a>';
        }).join('') +
        '</div>' +
        '<p class="texto-apoio">Toque numa foto para ver em tamanho cheio.</p>';
    });
  }

  // Puxa (do cache na hora e do servidor em seguida) os detalhes completos da OS
  // e injeta as seções ricas. Só aplica se ainda estamos nesta OS/tela.
  function preencherDetalhesOS(o) {
    if (!o.osId || !EC.os) return;
    var cacheado = EC.os.detalhesCache ? EC.os.detalhesCache(o.osId) : null;
    if (cacheado) aplicarDetalhesOS(cacheado);
    if (EC.os.carregarDetalhes) {
      EC.os.carregarDetalhes(o.osId).then(function (fresh) {
        if (fresh && telaExibida === 'tela-dados-gerais' && estado && estado.os && estado.os.osId === o.osId) {
          aplicarDetalhesOS(fresh);
        }
      });
    }
  }

  function aplicarDetalhesOS(det) {
    var el;
    // Descrição (dentro de "Serviço")
    if ((el = $('dg-descricao'))) el.innerHTML = det.descricao ? dgCampo('Descrição', det.descricao) : '';
    // Origem / Destino
    if ((el = $('dg-origem-destino'))) el.innerHTML = (det.origem || det.destino)
      ? dgGrade2(dgCampo('Origem', det.origem), dgCampo('Destino', det.destino)) : '';
    // Local do serviço detalhado (quando há mais do que o do contratante)
    if ((el = $('dg-local-extra')) && det.local && (det.local.endereco || det.local.cidade || det.local.contato || det.local.referencia)) {
      var L = det.local;
      el.innerHTML =
        dgCampo('Endereço', L.endereco) +
        dgCampo('Município / UF', L.cidade) +
        (L.contato ? dgCampo('Contato no local', L.contato) : '') +
        (L.referencia ? dgCampo('Ponto de referência', L.referencia) : '');
    }
    // Metodologia / normas de referência
    if ((el = $('dg-metodologia'))) {
      var mets = (det.metodologia || []).filter(function (m) { return m && (m.escopo || m.norma || m.matriz); });
      el.innerHTML = mets.length
        ? dgSecao('Metodologia / normas de referência') + mets.map(function (m) {
            return dgCampo(m.escopo || m.matriz || 'Ensaio',
              juntar([m.norma, m.revisao ? ('Rev. ' + m.revisao) : '', m.pop ? ('POP ' + m.pop) : ''], ' · '));
          }).join('')
        : '';
    }
    // Informações por campanha
    if ((el = $('dg-campanhas'))) {
      var camps = det.campanhas || [];
      el.innerHTML = camps.length ? dgSecao('Informações por campanha') + camps.map(htmlCampanha).join('') : '';
    }
  }

  function htmlCampanha(c) {
    var fmt = function (d) { return d ? formatarDataBR(d) : ''; };
    var datas = (c.dataPrev || c.dataFim)
      ? dgGrade2(dgCampo('Data prevista', fmt(c.dataPrev)), dgCampo('Data fim', fmt(c.dataFim)))
      : (c.previsaoTexto ? dgCampo('Previsão', c.previsaoTexto) : '');
    var dias = dgGrade2(dgCampo('Dias de serviço', c.diasServico), dgCampo('Dias de deslocamento', c.deslocDias));
    var maisDias = dgGrade2(dgCampo('Total de dias', c.totalDias), dgCampo('Nº de técnicos', c.qtdTecnicos));
    var escopos = (c.escopos || []).map(function (e) {
      return '<div class="dg-escopo-min">' +
        '<div class="dg-escopo-nome">' + escDg(e.nome || 'Escopo') + (e.norma ? ' · ' + escDg(e.norma) : '') + '</div>' +
        (juntar(e.periodos) ? dgCampo('Período', juntar(e.periodos)) : '') +
        (juntar(e.metodo) ? dgCampo('Método', juntar(e.metodo)) : '') +
        (juntar(e.detalhes, ' · ') ? dgCampo('Detalhes', juntar(e.detalhes, ' · ')) : '') +
        (e.obs ? dgCampo('Observação', e.obs) : '') +
      '</div>';
    }).join('');
    return '<div class="dg-camp-card">' +
      '<div class="dg-camp-tit">Campanha ' + escDg(c.numero) + '</div>' +
      datas + dias + maisDias + escopos +
    '</div>';
  }

  function pontosAlterados() {
    return parseInt(estado.dadosGerais.qtdePontos, 10) !== parseInt(estado.dadosGerais.qtdePontosOS, 10);
  }

  function atualizarJustificativaPontos() {
    $('dg-justificativa-bloco').classList.toggle('oculto', !pontosAlterados());
  }

  function coletarDadosGerais() {
    if (!estado) return;
    // data/hora são só leitura (vêm do preenchimento automático); o link do
    // Maps já é salvo pelo oninput, mas recolhe aqui também (mesmo padrão de
    // pontos/justificativa) — cobre o caso de sair sem disparar o evento.
    estado.dadosGerais.qtdePontos = parseInt($('dg-pontos').value, 10) || estado.dadosGerais.qtdePontos;
    estado.dadosGerais.justificativaPontos = $('dg-justificativa').value.trim();
    estado.os.linkMaps = $('dg-maps').value.trim();
  }

  /* ---------- Tipo de monitoramento ---------- */

  // O tipo de monitoramento SEGUE o escopo cadastrado na OS — não é escolha
  // livre do técnico (decisão Raisa 2026-07-07: escolher um tipo diferente do
  // escopo real da OS fazia o servidor tratar o registro como outro escopo,
  // e as fotos/planilha não batiam com o serviço de verdade). Quando o escopo
  // é reconhecido, o tipo fica travado nele — se um rascunho antigo tinha
  // outro tipo guardado, corrige e limpa o que não bate (com aviso). Só
  // quando o escopo NÃO é reconhecido (texto fora do padrão) sobra a escolha
  // manual, como último recurso.
  function renderizarTipos() {
    const detectado = EC.mapaEscopo.tipoPorEscopo(servicoDetalhe('escopo'));
    const hint = $('tipo-hint');
    const grade = $('grade-tipos');

    if (detectado) {
      if (estado.tipo !== detectado) {
        const tinhaProgresso = estado.equipamentos.length || estado.campo;
        estado.tipo = detectado;
        estado.equipamentos = [];
        estado.preCampo = {};
        estado.campo = null;
        salvarEstado();
        if (tinhaProgresso) EC.app.mostrarToast('Tipo ajustado para bater com o escopo da OS — equipamentos e campo foram reiniciados.');
      }
      hint.className = 'alerta alerta-info';
      hint.innerHTML = '🔒 Definido pelo escopo da OS (“' + servicoDetalhe('escopo') + '”). Não dá para trocar aqui — se o escopo estiver errado, corrija na OS.';
      const tipo = TIPOS.filter(function (t) { return t.id === detectado; })[0];
      grade.innerHTML = tipo ? (
        '<button type="button" class="card-tipo card-tipo-ativo card-tipo-travado" disabled data-tipo="' + tipo.id + '">' +
        '  <img class="card-tipo-img" src="' + encodeURI('public/' + tipo.img) + '" alt="">' +
        '  <span>' + tipo.nome + '</span>' +
        '</button>'
      ) : '';
      return;
    }

    hint.className = 'alerta alerta-amarelo';
    hint.innerHTML = '⚠️ Escopo da OS não reconhecido automaticamente. Selecione o tipo com cuidado.';

    grade.innerHTML = TIPOS.map(function (tipo) {
      const ativo = estado.tipo === tipo.id;
      return (
        '<button type="button" class="card-tipo' + (ativo ? ' card-tipo-ativo' : '') + '" data-tipo="' + tipo.id + '">' +
        '  <img class="card-tipo-img" src="' + encodeURI('public/' + tipo.img) + '" alt="">' +
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

  // Ícone (HTML) de um tipo/subtipo: usa a imagem própria quando existe (mesma
  // dos cartões), senão cai no emoji.
  function htmlIcone(item) {
    return item.img
      ? '<img class="icone-inline" src="' + encodeURI('public/' + item.img) + '" alt="">'
      : item.icone;
  }

  function nomeTipo(id) {
    const tipo = TIPOS.filter(function (t) { return t.id === id; })[0];
    return tipo ? htmlIcone(tipo) + ' ' + tipo.nome : '—';
  }

  /* ---------- Seleção de equipamentos (mock — real na Fase 6) ---------- */

  function renderizarEquipamentos() {
    const area = $('equipamentos-conteudo');
    const lista = EC.equip.porVariante(chaveVariante());

    if (!lista) {
      if (estado.tipo === 'outro') {
        // Tipo Outro: cadastro manual dos equipamentos (campo de texto livre).
        area.innerHTML =
          '<p class="texto-apoio">Para o tipo <strong>Outro</strong>, liste manualmente os equipamentos utilizados (um por linha, com modelo / nº de série quando possível).</p>' +
          '<label>Equipamentos utilizados<textarea id="equip-manual" rows="5" placeholder="Ex.: Decibelímetro Instrutherm DEC-490 nº 12345&#10;Tripé"></textarea></label>';
        const ta = area.querySelector('#equip-manual');
        if (estado.equipamentosManual) ta.value = estado.equipamentosManual;
        ta.addEventListener('input', function () { estado.equipamentosManual = ta.value; salvarEstado(); });
        return;
      }
      area.innerHTML = '<p class="texto-apoio">A seleção de equipamentos deste tipo entra nas próximas fases (lista da planilha F021 na Fase 6).</p>';
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
    const lista = EC.equip.porVariante(chaveVariante());
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
    EC.romaneios.renderizar($('precampo-conteudo'), chaveVariante(), estado.preCampo, function () {
      salvarEstado();
    }, opcoesRomaneio());
  }

  /* ---------- Transição preparação → campo ---------- */

  function renderizarCheckpoint() {
    const equip = estado.equipamentos.length;
    const pendentesPre = EC.romaneios.pendentesObrigatorios(chaveVariante(), estado.preCampo, opcoesRomaneio());
    $('checkpoint-resumo').innerHTML =
      linhaResumo('Nº da OS', (estado.os && estado.os.numero) || '—') +
      linhaResumo('Nome do projeto', (estado.os && estado.os.projeto) || '—') +
      linhaResumo('Escopo', servicoDetalhe('escopo')) +
      linhaResumo('Tipo', nomeTipo(estado.tipo)) +
      linhaResumo('Método', servicoDetalhe('metodo')) +
      linhaResumo('Período', servicoDetalhe('periodo')) +
      linhaResumo('Equipamentos', equip ? equip + ' selecionado(s)' : '—') +
      linhaResumo('Pré-campo', pendentesPre === 0 ? '✓ obrigatórios conferidos' : 'falta(m) ' + pendentesPre + ' item(ns)');
  }

  /* ---------- Monitoramento em campo ---------- */

  // QAR Externo: por ora só o subtipo Particulados (PTS / PM10 / PM2,5) tem
  // formulário; gases e poeira sedimentável ainda entram como "em construção".
  function qarParticulado() {
    const e = (servicoDetalhe('escopo') || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return /\bpts\b|pm ?10|pm ?2[.,]?5|mp ?10|mp ?2[.,]?5|particulad/.test(e);
  }

  // Opacidade tem 2 subtipos (decididos pelo escopo): Opacímetro e Ringelmann.
  function subtipoOpacidade() {
    const e = (servicoDetalhe('escopo') || '').toLowerCase();
    return /ringelmann/.test(e) ? 'ringelmann' : 'opacimetro';
  }

  // Chave de EQUIPAMENTOS e ROMANEIO: alguns tipos variam por subtipo do escopo
  // (ex.: opacidade_opacimetro / opacidade_ringelmann). Para os demais, é o tipo.
  function chaveVariante() {
    if (estado.tipo === 'opacidade') return 'opacidade_' + subtipoOpacidade();
    return estado.tipo;
  }

  function renderizarCampo() {
    $('campo-bloqueio').innerHTML = '';
    const area = $('campo-conteudo');
    if (estado.tipo === 'ruido') {
      EC.campoRuido.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else if (estado.tipo === 'sismo') {
      EC.campoVibracao.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else if (estado.tipo === 'qar' && qarParticulado()) {
      EC.campoQar.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else if (estado.tipo === 'opacidade') {
      EC.campoOpacidade.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else if (estado.tipo === 'qarint') {
      EC.campoQarInterno.renderizar(area, { estado: estado, salvar: salvarEstado });
    } else if (estado.tipo === 'outro') {
      EC.campoOutro.renderizar(area, { estado: estado, salvar: salvarEstado });
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

    if (estado.tipo === 'ruido' || estado.tipo === 'sismo' || estado.tipo === 'qar' || estado.tipo === 'opacidade' || estado.tipo === 'qarint' || estado.tipo === 'outro') {
      const faltandoEquip = categoriasEquipFaltando();
      if (faltandoEquip.length) avisos.push('Equipamentos: falta selecionar ' + faltandoEquip.join(', ') + '.');
      if (estado.tipo === 'outro' && !(estado.equipamentosManual && estado.equipamentosManual.trim())) {
        avisos.push('Equipamentos: liste os equipamentos utilizados.');
      }
      const pendentesPre = EC.romaneios.pendentesObrigatorios(chaveVariante(), estado.preCampo, opcoesRomaneio());
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
    if (estado.tipo === 'sismo' && EC.campoVibracao.itensFaltando) {
      return EC.campoVibracao.itensFaltando(estado);
    }
    if (estado.tipo === 'qar' && qarParticulado() && EC.campoQar.itensFaltando) {
      return EC.campoQar.itensFaltando(estado);
    }
    if (estado.tipo === 'opacidade' && EC.campoOpacidade.itensFaltando) {
      return EC.campoOpacidade.itensFaltando(estado);
    }
    if (estado.tipo === 'qarint' && EC.campoQarInterno.itensFaltando) {
      return EC.campoQarInterno.itensFaltando(estado);
    }
    if (estado.tipo === 'outro' && EC.campoOutro.itensFaltando) {
      return EC.campoOutro.itensFaltando(estado);
    }
    return [];
  }

  function renderizarRevisao() {
    const area = $('revisao-conteudo');
    let html = '';

    html += secaoRevisao('📄 Dados gerais',
      linhaResumo('Nº da OS', estado.os.numero) +
      linhaResumo('Código', estado.os.codigo) +
      linhaResumo('Nome do projeto', estado.os.projeto) +
      linhaResumo('Cliente', estado.os.cliente) +
      linhaResumo('CNPJ / CPF', estado.os.cnpjCpf) +
      linhaResumo('Endereço', estado.os.endereco) +
      linhaResumo('Município / UF', estado.os.municipioUF) +
      linhaResumo('Contato', estado.os.contato) +
      linhaResumo('Serviço', estado.os.resumo) +
      linhaResumo('Frequência', estado.os.frequencia) +
      linhaResumo('Rota', estado.os.rota) +
      linhaResumo('Nº de campanhas', estado.os.numCampanhas) +
      linhaResumo('Campanha', servicoDetalhe('campanha')) +
      linhaResumo('Escopo', servicoDetalhe('escopo')) +
      linhaResumo('Pontos', estado.dadosGerais.qtdePontos + (pontosAlterados() ? ' (OS previa ' + estado.dadosGerais.qtdePontosOS + ')' : '')) +
      (pontosAlterados() ? linhaResumo('Justificativa dos pontos', estado.dadosGerais.justificativaPontos) : '') +
      linhaResumo('Dias de medição', estado.servico.dias) +
      linhaResumo('Período', servicoDetalhe('periodo')) +
      linhaResumo('Método', servicoDetalhe('metodo')) +
      linhaResumo('Observação do escopo', servicoDetalhe('observacao')) +
      linhaResumo('Observações da OS', estado.os.observacao) +
      linhaResumo('Link do Google Maps', estado.os.linkMaps) +
      linhaResumo('Início', formatarDataBR(estado.dadosGerais.dataInicio) + ' às ' + estado.dadosGerais.horaInicio),
      'tela-dados-gerais');

    html += secaoRevisao('🧭 Tipo de monitoramento', linhaResumo('Tipo', nomeTipo(estado.tipo)), 'tela-tipo');

    html += secaoRevisao('🔧 Equipamentos',
      linhaResumo('Selecionados', estado.tipo === 'outro'
        ? (estado.equipamentosManual ? estado.equipamentosManual : '—')
        : (estado.equipamentos.length ? estado.equipamentos.join(', ') : '—')),
      'tela-passo3a');

    let resumoPre = '—';
    if (EC.romaneios.dados[chaveVariante()]) {
      const pendentesPre = EC.romaneios.pendentesObrigatorios(chaveVariante(), estado.preCampo, opcoesRomaneio());
      resumoPre = pendentesPre === 0 ? '✓ itens obrigatórios conferidos' : 'falta(m) ' + pendentesPre + ' item(ns) obrigatório(s)';
    }
    html += secaoRevisao('✅ Pré-campo', linhaResumo('Checklist', resumoPre), 'tela-passo3b');

    let corpoCampo = '<p class="texto-apoio">Monitoramento em campo não iniciado.</p>';
    if (estado.tipo === 'qarint' && estado.campo && estado.campo.geral) {
      const campo = estado.campo;
      const totalAmb = Math.min(20, Math.max(0, parseInt(campo.geral.qtdeAmbientes, 10) || 0));
      corpoCampo = linhaResumo('Ambientes', totalAmb || '—');
      for (let a = 0; a < totalAmb; a++) {
        const amb = (campo.ambientes || [])[a] || {};
        const np = amb.pontosCalculados ? (amb.pontosCalculados + 1) : 0;
        corpoCampo += linhaResumo('Amb ' + (a + 1) + (amb.nome ? ' — ' + amb.nome : ''),
          (amb.area ? amb.area + ' m²' : '— m²') + ' · ' + (np ? np + ' ponto(s)' : 'pontos não calculados'));
      }
    } else if (estado.tipo === 'opacidade' && estado.campo && estado.campo.geral) {
      const campo = estado.campo;
      const total = Math.min(50, Math.max(0, parseInt(campo.geral.qtdeVeiculos, 10) || 0));
      corpoCampo = linhaResumo('Subtipo', campo.subtipo === 'ringelmann' ? '🌫️ Escala de Ringelmann' : (campo.subtipo === 'opacimetro' ? '💨 Opacímetro' : '—')) +
        linhaResumo('Veículos', total || '—');
      for (let i = 0; i < total; i++) {
        const v = (campo.veiculos || [])[i] || {};
        corpoCampo += linhaResumo('V' + (i + 1) + (v.placa ? ' — ' + v.placa : ''),
          (v.gps ? '📍GPS ✓' : '📍GPS —') + ' · ' + (EC.foto.tem(v.foto) ? '📷 ✓' : '📷 —'));
      }
    } else if (estado.tipo === 'outro' && estado.campo && estado.campo.geral) {
      const campo = estado.campo;
      corpoCampo = (campo.geral.tipoMonitoramento ? linhaResumo('Tipo de monitoramento', campo.geral.tipoMonitoramento) : '') +
        (campo.geral.objetivo ? linhaResumo('Objetivo', campo.geral.objetivo) : '');
      const total = Math.min(20, Math.max(0, parseInt(campo.geral.qtdePontos, 10) || 0));
      for (let i = 0; i < total; i++) {
        const p = campo.pontos[i] || {};
        corpoCampo += linhaResumo('P' + (i + 1) + (p.nome ? ' — ' + p.nome : ''),
          (p.gps ? '📍GPS ✓' : '📍GPS —') + ' · ' + (EC.foto.tem(p.fotoPonto) ? '📷 ✓' : '📷 —'));
      }
      if (!corpoCampo) corpoCampo = '<p class="texto-apoio">Monitoramento em campo não iniciado.</p>';
    } else if ((estado.tipo === 'sismo' || estado.tipo === 'qar') && estado.campo && estado.campo.geral) {
      const campo = estado.campo;
      corpoCampo = (campo.geral.objetivo ? linhaResumo('Objetivo', campo.geral.objetivo) : '');
      const total = Math.min(20, Math.max(0, parseInt(campo.geral.qtdePontos, 10) || 0));
      for (let i = 0; i < total; i++) {
        const p = campo.pontos[i] || {};
        const extra = estado.tipo === 'qar'
          ? ('📷 ' + (EC.foto.tem(p.fotoPonto) ? '✓' : '—') + ' · 🧪 ' + (p.qtdeColetas ? p.qtdeColetas + ' coleta(s)' : '—'))
          : (EC.foto.tem(p.fotoPonto) ? '📷 ✓' : '📷 —');
        corpoCampo += linhaResumo('P' + (i + 1) + (p.nome ? ' — ' + p.nome : ''),
          (p.gps ? '📍GPS ✓' : '📍GPS —') + ' · ' + extra);
      }
      if (!corpoCampo) corpoCampo = '<p class="texto-apoio">Monitoramento em campo não iniciado.</p>';
    } else if (estado.campo && estado.campo.subtipo) {
      const campo = estado.campo;
      const sub = EC.campoRuido.SUBTIPOS.filter(function (s) { return s.id === campo.subtipo; })[0];
      corpoCampo = linhaResumo('Subtipo', sub ? htmlIcone(sub) + ' ' + sub.nome : campo.subtipo);
      const interno = campo.subtipo === 'interno10151' || campo.subtipo === 'interno10152';
      if (interno) {
        // Interno: um bloco por AMBIENTE (cada um com seus pontos).
        const ambientes = campo.ambientes || [];
        const totalAmb = Math.min(20, Math.max(0, parseInt(campo.geral.qtdeAmbientes, 10) || 0));
        corpoCampo += linhaResumo('Ambientes', String(totalAmb));
        for (let a = 0; a < totalAmb; a++) {
          const amb = ambientes[a] || {};
          corpoCampo += linhaResumo('Ambiente ' + (a + 1) + (amb.nome ? ' — ' + amb.nome : ''),
            (amb.area ? amb.area + ' m² · ' : '') +
            (amb.pontosCalculados ? amb.pontosCalculados + ' ponto(s)' : 'pontos não calculados'));
        }
      } else {
        corpoCampo += (campo.geral.finalidade ? linhaResumo('Finalidade', campo.geral.finalidade) : '');
        const total = Math.min(20, Math.max(0, parseInt(campo.geral.qtdePontos, 10) || 0));
        for (let i = 0; i < total; i++) {
          const p = campo.pontos[i] || {};
          const fotos = ['fotoTelaIni', 'fotoPonto', 'fotoTelaFim'].filter(function (chave) { return EC.foto.tem(p[chave]); }).length;
          corpoCampo += linhaResumo('P' + (i + 1) + (p.nome ? ' — ' + p.nome : ''),
            (p.gps ? '📍GPS ✓' : '📍GPS —') + ' · ' +
            (p.chkIniValor ? 'chk.ini ✓' : 'chk.ini —') + ' · ' +
            (p.chkFimValor ? 'chk.fim ✓' : 'chk.fim —') + ' · 📷 ' + fotos);
        }
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
    let tipoTexto;
    if (estado.tipo === 'ruido' && estado.campo && estado.campo.subtipo) {
      tipoTexto = EC.campoRuido.TIPOS_CARIMBO[estado.campo.subtipo];
    } else if (estado.tipo === 'opacidade') {
      tipoTexto = (estado.campo && estado.campo.subtipo === 'ringelmann') ? 'OPACIDADERINGELMANN' : 'OPACIMETRO';
    } else {
      tipoTexto = (estado.tipo || 'SEMTIPO').toUpperCase();
    }
    return {
      codificacao: 'OS_' + estado.os.numero + '_' + tipoTexto + '_' + carimboDataHora(agora),
      rascunhoId: estado.rascunhoId,
      servicoId: estado.servicoId,
      os: estado.os,
      servico: estado.servico,
      tecnico: sessao.nome || '',
      tipo: estado.tipo,
      // passo em que o técnico estava — sem isso, ao CONTINUAR DO SERVIDOR o app
      // reabria sempre nos dados gerais (o "início"), perdendo o lugar.
      passoAtual: estado.passoAtual,
      dadosGerais: estado.dadosGerais,
      equipamentos: estado.equipamentos,
      preCampo: estado.preCampo,
      campo: estado.campo,
      salvoEm: agora.toISOString()
    };
  }

  // Cópia do registro SEM o base64/dataUrl das fotos (que já vão para o servidor).
  // Mantém só os nomes dos arquivos. Evita estourar a memória do navegador.
  function semFotos(registro) {
    return JSON.parse(JSON.stringify(registro, function (chave, valor) {
      return (chave === 'base64' || chave === 'dataUrl') ? undefined : valor;
    }));
  }

  function salvarRegistro() {
    const bloqueios = bloqueiosSalvar();
    if (bloqueios.length) {
      EC.app.mostrarToast('Há item(ns) obrigatório(s) em branco no monitoramento em campo.');
      prepararFinalizar();
      return;
    }
    const registro = montarRegistro();

    // 1) Envia ao servidor PRIMEIRO (destino oficial: SGP → Supabase + SharePoint),
    //    com as fotos. Se offline, tenta enfileirar. O servidor devolve a REVISÃO
    //    (numerada lá); ela fica guardada no registro para uso futuro — o código
    //    do PDF NÃO a usa (decisão Raisa 2026-07-06).
    if (EC.sync) {
      EC.sync.sincronizarRegistro(registro, function (resp) {
        if (resp && typeof resp.revisao === 'number') {
          registro.revisao = resp.revisao;
          if (EC.db && EC.db.disponivel()) EC.db.set('registros', registro.codificacao, registro).catch(function () {});
        }
      });
    }

    // 2) Guarda uma cópia LEVE no histórico do aparelho (sem o base64 das fotos —
    //    elas já foram para o servidor), para NÃO estourar a memória do navegador.
    //    Best-effort: se nem isso couber, tudo bem, o dado já foi enviado.
    try {
      const antigos = EC.storage.listar('historico:')
        .sort(function (a, b) { return (a.valor.salvoEm || '').localeCompare(b.valor.salvoEm || ''); });
      // fallback leve (sem fotos, KB por registro): guarda bastante — é a cópia
      // mais durável do histórico (localStorage sobrevive mesmo sem o IndexedDB).
      while (antigos.length >= 60) EC.storage.remover(antigos.shift().chave);
    } catch (e) { /* ignora */ }
    EC.storage.salvar('historico:' + registro.codificacao, semFotos(registro));

    // 2b) Guarda o registro COMPLETO (com fotos) no IndexedDB por 30 dias —
    //     permite regerar o PDF depois pelo "🕐 Histórico recente" (ex.: o
    //     técnico saiu da tela de conclusão sem compartilhar). Best-effort.
    if (EC.db && EC.db.disponivel()) {
      EC.db.set('registros', registro.codificacao, registro).catch(function () {});
      EC.db.getAll('registros').then(function (todos) {
        const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
        (todos || []).forEach(function (r) {
          const t = Date.parse((r && r.salvoEm) || '');
          if (r && r.codificacao && t && t < limite) EC.db.remove('registros', r.codificacao).catch(function () {});
        });
      }).catch(function () {});
    }

    EC.storage.remover(chaveServico(estado.osNumero, estado.servicoIndice)); // rascunho do serviço concluído
    if (EC.db) EC.db.remove('rascunhos', chaveServico(estado.osNumero, estado.servicoIndice)).catch(function () {});
    pararTravaEdicao(); // serviço finalizado → libera a trava de edição

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

    // guarda o registro COMPLETO (com fotos) e já dispara a geração AUTOMÁTICA
    // do PDF; quando pronto, o botão vira "Encaminhar" (WhatsApp).
    ultimoRegistroPdf = registro;
    iniciarPdfAutomatico(registro);

    estado = null;
    if (EC.app.atualizarBarraPendencias) EC.app.atualizarBarraPendencias();
  }

  // PDF automático da finalização: gera e guarda (aparelho + SharePoint) assim
  // que o registro é salvo. O compartilhar (WhatsApp) exige um toque do usuário
  // (regra do navegador), então o botão fica pronto esperando o toque.
  let pdfPronto = null; // { blob, nome } do PDF gerado na finalização

  function iniciarPdfAutomatico(registro) {
    const btn = $('sucesso-pdf');
    pdfPronto = null;
    if (!(EC.pdf && EC.pdf.suporta(registro) && EC.pdf.gerarSalvar)) {
      btn.classList.add('oculto');
      return;
    }
    btn.classList.remove('oculto');
    btn.disabled = true;
    btn.textContent = '⏳ Gerando PDF…';
    Promise.resolve(EC.pdf.gerarSalvar(registro))
      .then(function (res) {
        pdfPronto = res;
        btn.textContent = '📤 Encaminhar PDF (WhatsApp)';
        EC.app.mostrarToast('PDF pronto! Toque em "Encaminhar" para enviar.');
      })
      .catch(function () {
        btn.textContent = '📄 Gerar PDF novamente';
        EC.app.mostrarToast('Não consegui gerar o PDF — toque no botão para tentar de novo.');
      })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- Amarração dos botões ---------- */

  function aoSalvarRascunho() {
    if (estado && telaExibida === 'tela-dados-gerais') coletarDadosGerais();
    if (estado) estado.iniciado = true; // salvar rascunho conta como iniciar
    const ok = salvarEstado(); // salva localmente (continuar no mesmo aparelho)
    // Também envia ao servidor como INCOMPLETO (aparece na planilha; continuar
    // em outro aparelho). Best-effort — se faltar dado ou internet, fica só local.
    if (estado && EC.sync && EC.sync.sincronizarRascunho) {
      const registro = montarRegistro();
      registro.finalizar = false;
      EC.sync.sincronizarRascunho(registro);
    }
    return ok;
  }

  // Salva a PREPARAÇÃO (parte do laboratório) como rascunho — no aparelho E no
  // servidor (Incompleto), para não se perder e poder ser entregue ao campo.
  // No ruído, inicializa o subtipo do campo aqui, assim o servidor já aceita o
  // rascunho na preparação (antes de ir a campo).
  function salvarPreparacaoRascunho() {
    if (!estado) return;
    if (estado.tipo === 'ruido' && (!estado.campo || !estado.campo.subtipo)) {
      const sub = (EC.mapaEscopo && EC.mapaEscopo.subtipoPorEscopo)
        ? EC.mapaEscopo.subtipoPorEscopo(servicoDetalhe('escopo'), servicoDetalhe('metodo'))
        : null;
      estado.campo = estado.campo || { geral: {}, pontos: [] };
      estado.campo.subtipo = sub || 'externo';
      estado.campo.geral = estado.campo.geral || {};
      estado.campo.pontos = estado.campo.pontos || [];
    }
    aoSalvarRascunho();
  }

  function montarNavegacao(idTela, opcoesExtras) {
    const container = $(idTela.replace('tela-', '') + '-nav');
    EC.navegacao.criar(container, Object.assign({
      aoVoltar: function () { irPara(anterior(idTela)); },
      aoProximo: function () { irPara(proximo(idTela)); autoPushDados(); },
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
        const pendentes = EC.romaneios.pendentesObrigatorios(chaveVariante(), estado.preCampo, opcoesRomaneio());
        if (pendentes > 0) {
          EC.app.mostrarToast('Conclua o pré-campo: falta(m) ' + pendentes + ' item(ns) obrigatório(s).');
          return;
        }
        irPara('tela-checkpoint');
      }
    });
    $('checkpoint-ir').addEventListener('click', function () {
      salvarPreparacaoRascunho(); // preparação segura (aparelho + servidor) antes do campo
      irPara('tela-passo4');
    });
    $('checkpoint-salvar').addEventListener('click', salvarPreparacaoRascunho);
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
      // PDF já foi gerado automaticamente na finalização → só encaminhar.
      if (pdfPronto && EC.pdf && EC.pdf.compartilharPdf) {
        EC.pdf.compartilharPdf(pdfPronto, ultimoRegistroPdf && ultimoRegistroPdf.os && ultimoRegistroPdf.os.numero);
        return;
      }
      // A geração automática falhou → tenta de novo; ao terminar, o botão
      // vira "Encaminhar" e o técnico toca para enviar.
      if (!ultimoRegistroPdf || !EC.pdf || !EC.pdf.suporta(ultimoRegistroPdf)) {
        EC.app.mostrarToast('Não há registro para gerar o PDF.');
        return;
      }
      iniciarPdfAutomatico(ultimoRegistroPdf);
    });
  }

  let telasIniciadas = false;

  function iniciar() {
    if (!telasIniciadas) { telasIniciadas = true; inicializarTelas(); }
    // Escopo do usuário: parte do cache (mostra as OS certas já no 1º pintar) e
    // confirma com o servidor logo em seguida.
    if (EC.os && EC.os.prepararEscopoDoCache) EC.os.prepararEscopoDoCache();
    renderizarListaOs();
    EC.app.mostrarTela('tela-os');
    if (EC.os && EC.os.carregarEscopo) {
      EC.os.carregarEscopo().then(function () {
        const input = $('os-busca');
        if (input && !input.value.trim() && !$('tela-os').classList.contains('oculto')) pintarOs('');
      });
    }
    // Quem está preenchendo cada OS (tag "Em andamento · Fulano").
    if (EC.os && EC.os.carregarAndamentoPor) {
      EC.os.carregarAndamentoPor().then(function () {
        const input = $('os-busca');
        if (input && !input.value.trim() && !$('tela-os').classList.contains('oculto')) pintarOs('');
      });
    }
    // Atualiza a lista com o servidor em segundo plano; repinta se ainda estiver
    // na tela de OS e sem busca ativa (não atrapalha quem já está digitando).
    if (EC.os && EC.os.carregar) {
      EC.os.carregar(function () {
        const input = $('os-busca');
        if (input && !input.value.trim() && !$('tela-os').classList.contains('oculto')) pintarOs('');
      });
    }
    // Já vai buscando os equipamentos do SGP (usados na tela de equipamentos).
    if (EC.equip && EC.equip.carregar) EC.equip.carregar();
  }

  // Reabre um rascunho a partir do menu "Rascunhos" (número da OS + índice do
  // serviço). Acha a OS na lista do aparelho e cai no mesmo fluxo do toque na
  // lista de serviços (continuar / reiniciar / descartar).
  function continuarRascunho(numeroOs, indice) {
    if (!telasIniciadas) { telasIniciadas = true; inicializarTelas(); }
    const os = (EC.os && EC.os.osPorNumero) ? EC.os.osPorNumero(numeroOs) : null;
    if (!os || !os.servicos || !os.servicos[indice]) {
      EC.app.mostrarToast('Essa OS não está na lista atual do aparelho. Abra em "Serviços" e busque por ela.');
      return;
    }
    if (EC.os && EC.os.marcarRecente) EC.os.marcarRecente(numeroOs);
    aoTocarServico(os, indice);
  }

  return { iniciar: iniciar, continuarRascunho: continuarRascunho };
})();
