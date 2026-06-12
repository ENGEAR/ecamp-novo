/**
 * app.js — Orquestração do eCamp (Fase 0)
 *
 * Responsabilidades:
 *  - registrar o service worker (PWA offline-first)
 *  - login/logout e sessão persistente (localStorage, prefixo 'sessao:')
 *  - navegação entre telas + header persistente
 *  - barra de pendências offline (detecção online/offline; sync real: Fase 7)
 *  - overlays-placeholder do header (Histórico, Rascunhos, Agenda, Biblioteca)
 *  - bancada de teste dos componentes transversais (com dados mockados)
 */
(function () {
  'use strict';

  const SENHA_APP = 'campo26*';
  const CHAVE_SESSAO = 'sessao:atual';
  const CHAVE_SENHA_SALVA = 'sessao:senhaSalva';

  function $(id) { return document.getElementById(id); }

  /* ============ Service worker (PWA) ============ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function (erro) {
        console.error('Falha ao registrar o service worker:', erro);
      });
    });
  }

  /* ============ Navegação entre telas ============ */
  function mostrarTela(id) {
    document.querySelectorAll('.tela').forEach(function (tela) {
      tela.classList.add('oculto');
    });
    $(id).classList.remove('oculto');
    window.scrollTo(0, 0);
  }

  /* ============ Toast de feedback ============ */
  let temporizadorToast = null;
  function mostrarToast(mensagem) {
    const toast = $('toast');
    toast.textContent = mensagem;
    toast.classList.remove('oculto');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(function () { toast.classList.add('oculto'); }, 2600);
  }

  /* ============ Sessão / Login ============ */
  function sessaoAtual() { return EC.storage.ler(CHAVE_SESSAO); }

  function entrarNoApp() {
    const sessao = sessaoAtual();
    $('chip-nome').textContent = sessao.nome;
    $('chip-avatar').textContent = (sessao.nome.trim().charAt(0) || '?').toUpperCase();
    $('header').classList.remove('oculto');
    atualizarBarraPendencias();
    mostrarTela('tela-acao');
  }

  function prepararLogin() {
    $('header').classList.add('oculto');
    $('barra-pendencias').classList.add('oculto');
    $('login-erro').classList.add('oculto');
    $('login-nome').value = '';
    const senhaSalva = EC.storage.ler(CHAVE_SENHA_SALVA);
    $('login-senha').value = senhaSalva || '';
    $('login-salvar-senha').checked = !!senhaSalva;
    mostrarTela('tela-login');
  }

  $('form-login').addEventListener('submit', function (evento) {
    evento.preventDefault();
    const nome = $('login-nome').value.trim();
    const senha = $('login-senha').value;

    if (senha !== SENHA_APP) {
      const erro = $('login-erro');
      erro.textContent = '🛑 Senha incorreta. Verifique e tente novamente.';
      erro.classList.remove('oculto');
      return;
    }

    if ($('login-salvar-senha').checked) {
      EC.storage.salvar(CHAVE_SENHA_SALVA, senha);
    } else {
      EC.storage.remover(CHAVE_SENHA_SALVA);
    }
    EC.storage.salvar(CHAVE_SESSAO, {
      nome: nome,
      senhaSalva: $('login-salvar-senha').checked,
      entrouEm: new Date().toISOString()
    });
    entrarNoApp();
  });

  $('chip-usuario').addEventListener('click', function () {
    if (confirm('Sair do eCamp?')) {
      EC.storage.remover(CHAVE_SESSAO);
      prepararLogin();
    }
  });

  /* ============ Header: logo volta à tela inicial ============ */
  $('header-logo').addEventListener('click', function () {
    // Volta à tela inicial; o "iniciar novo registro" real entra na Fase 1,
    // quando existir o fluxo de serviços.
    mostrarTela('tela-acao');
  });

  /* ============ Escolha da ação ============ */
  $('btn-servicos').addEventListener('click', function () {
    mostrarTela('tela-servicos');
  });
  $('btn-reembolso').addEventListener('click', function () {
    $('fase2-titulo').textContent = '💰 Solicitação de reembolso';
    mostrarTela('tela-fase2');
  });
  $('btn-agenda-acao').addEventListener('click', function () {
    $('fase2-titulo').textContent = '📅 Agenda';
    mostrarTela('tela-fase2');
  });
  $('btn-bancada').addEventListener('click', abrirBancada);

  /* ============ Overlays-placeholder do header ============ */
  function abrirOverlay(titulo, html) {
    $('overlay-titulo').textContent = titulo;
    $('overlay-conteudo').innerHTML = html;
    $('overlay').classList.remove('oculto');
  }
  $('overlay-fechar').addEventListener('click', function () {
    $('overlay').classList.add('oculto');
  });
  $('overlay').addEventListener('click', function (evento) {
    if (evento.target === $('overlay')) $('overlay').classList.add('oculto');
  });

  $('btn-historico').addEventListener('click', function () {
    const itens = EC.storage.listar('historico:');
    abrirOverlay('🕐 Histórico', itens.length === 0
      ? '<p class="overlay-vazio">Nenhum monitoramento finalizado ainda.<br>A gestão completa do histórico entra na Fase 5.</p>'
      : itens.map(function (item) { return '<div class="overlay-item">' + item.chave + '</div>'; }).join(''));
  });

  $('btn-rascunhos').addEventListener('click', function () {
    const itens = EC.storage.listar('rascunho:');
    abrirOverlay('📝 Rascunhos', itens.length === 0
      ? '<p class="overlay-vazio">Nenhum rascunho salvo ainda.<br>O "continuar rascunho" completo entra na Fase 5.</p>'
      : itens.map(function (item) {
          const salvoEm = item.valor && item.valor.salvoEm
            ? new Date(item.valor.salvoEm).toLocaleString('pt-BR') : '';
          return '<div class="overlay-item">📝 ' + item.chave.replace('rascunho:', '') +
            (salvoEm ? '<br><small>salvo em ' + salvoEm + '</small>' : '') + '</div>';
        }).join('') +
        '<p class="texto-apoio">Listagem simples da Fase 0 — reabrir e continuar entra na Fase 5.</p>');
  });

  $('btn-agenda').addEventListener('click', function () {
    abrirOverlay('📅 Agenda', '<p class="overlay-vazio">🔒 Disponível na Fase 2.</p>');
  });

  $('btn-biblioteca').addEventListener('click', function () {
    abrirOverlay('📚 Biblioteca', '<p class="overlay-vazio">Normas e procedimentos entram na Fase 5.</p>');
  });

  /* ============ Barra de pendências offline ============ */
  function atualizarBarraPendencias() {
    const barra = $('barra-pendencias');
    if (!sessaoAtual()) {
      barra.classList.add('oculto');
      return;
    }
    const pendentes = EC.storage.listar('pending:').length;
    const semConexao = !navigator.onLine;

    if (semConexao || pendentes > 0) {
      let texto = '';
      if (semConexao) texto = '📡 Sem conexão';
      if (pendentes > 0) texto += (texto ? ' · ' : '') + '⏳ ' + pendentes + ' registro(s) pendente(s)';
      $('pendencias-texto').textContent = texto;
      barra.classList.remove('oculto');
    } else {
      barra.classList.add('oculto');
    }
  }

  window.addEventListener('online', function () {
    atualizarBarraPendencias();
    mostrarToast('✅ Conexão restabelecida.');
  });
  window.addEventListener('offline', function () {
    atualizarBarraPendencias();
    mostrarToast('📡 Sem conexão — o app continua funcionando offline.');
  });

  $('pendencias-ver').addEventListener('click', function () {
    const itens = EC.storage.listar('pending:');
    abrirOverlay('⏳ Pendentes de sincronização', itens.length === 0
      ? '<p class="overlay-vazio">Nenhum registro pendente.<br>A fila e a sincronização real entram nas Fases 5 e 7.</p>'
      : itens.map(function (item) { return '<div class="overlay-item">' + item.chave + '</div>'; }).join(''));
  });

  $('pendencias-sincronizar').addEventListener('click', function () {
    mostrarToast('A sincronização real com o SharePoint entra na Fase 7.');
  });

  /* ============ Bancada de teste dos componentes (Fase 0) ============ */
  let bancadaIniciada = false;

  function abrirBancada() {
    mostrarTela('tela-teste');
    if (bancadaIniciada) return;
    bancadaIniciada = true;

    // Dados mockados para os componentes (na Fase 1+ virão do fluxo real)
    const MOCK = { os: '2026-0158', tipo: 'RUIDOEXTERNO', ponto: 'P03' };

    const gps = EC.gps.criar($('teste-gps'), {});

    EC.foto.criar($('teste-foto'), {
      os: MOCK.os,
      tipo: MOCK.tipo,
      ponto: MOCK.ponto,
      obterUtm: function () {
        return gps.textoCarimbo() || '23K 612345 E 7791234 N (exemplo)';
      }
    });

    EC.paginacao.criar($('teste-paginacao'), {
      total: 5,
      aoMudar: function (numero) {
        $('teste-paginacao-info').textContent = 'Ponto ativo: P' + numero +
          ' — os formulários das próximas fases trocam o conteúdo conforme o ponto.';
      }
    });

    EC.alertaVento.criar($('teste-vento'), {});

    EC.checagens.criar($('teste-checagens'), {});

    EC.navegacao.criar($('teste-navegacao'), {
      chaveRascunho: 'OS_' + MOCK.os + '_' + MOCK.tipo + '_' + MOCK.ponto,
      obterDados: function () {
        return {
          campoExemplo: $('teste-campo-exemplo').value,
          gps: gps.obterDados()
        };
      },
      aoVoltar: function () { mostrarTela('tela-acao'); },
      aoProximo: function () { mostrarToast('Exemplo de "Próximo →" — o passo real entra na Fase 1.'); }
    });
  }

  /* ============ Botões de voltar dos placeholders ============ */
  $('servicos-voltar').addEventListener('click', function () { mostrarTela('tela-acao'); });
  $('fase2-voltar').addEventListener('click', function () { mostrarTela('tela-acao'); });

  /* ============ Inicialização ============ */
  if (sessaoAtual()) {
    entrarNoApp();
  } else {
    prepararLogin();
  }
})();
