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
 *
 * Expõe EC.app = { mostrarTela, mostrarToast, abrirOverlay, fecharOverlay }
 * para os módulos de fluxo (fluxo.js) reutilizarem a navegação e o feedback.
 */
(function () {
  'use strict';

  const SENHA_APP = 'campo26*';
  const CHAVE_SESSAO = 'sessao:atual';
  const CHAVE_SENHA_SALVA = 'sessao:senhaSalva';
  // Fallback exibido antes do cache responder; bump junto com VERSAO_CACHE no SW.
  const VERSAO_APP = '0.34.16';

  function $(id) { return document.getElementById(id); }

  /* ============ Versão no rodapé ============ */
  // Mostra a versão REAL: lê o nome do cache ativo do service worker (ecamp-vX.Y.Z).
  // Assim dá para conferir no celular se está na última versão. Se o app estiver
  // preso numa versão antiga, aparece a versão antiga aqui — o que já denuncia.
  function mostrarVersao() {
    const rodape = $('rodape');
    if (!rodape) return;
    const base = 'eCamp — Software desenvolvido pela ENGEAR Laboratório Ltda · versão ';
    rodape.textContent = base + VERSAO_APP;
    if ('caches' in window) {
      caches.keys().then(function (nomes) {
        const cache = nomes.filter(function (n) { return n.indexOf('ecamp-v') === 0; })[0];
        if (cache) rodape.textContent = base + cache.replace('ecamp-v', '');
      }).catch(function () { /* mantém o fallback */ });
    }
  }

  /* ============ Service worker (PWA) ============ */
  if ('serviceWorker' in navigator) {
    // Só recarrega quando uma ATUALIZAÇÃO assume o controle (não na 1ª instalação).
    const tinhaControlador = !!navigator.serviceWorker.controller;
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!tinhaControlador || recarregando) return;
      recarregando = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').then(function (registro) {
        function avisar(worker) {
          if (!worker) return;
          mostrarAvisoAtualizacao(function () { worker.postMessage({ type: 'SKIP_WAITING' }); });
        }
        // Acompanha um worker que está baixando até ficar "instalado" (em espera).
        function acompanhar(worker) {
          if (!worker) return;
          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) avisar(worker);
          });
        }
        // Cobre as três situações possíveis ao abrir (evita a corrida que deixava
        // o app preso na versão antiga): já em espera, ainda baixando, ou nova.
        if (registro.waiting) avisar(registro.waiting);
        if (registro.installing) acompanhar(registro.installing);
        registro.addEventListener('updatefound', function () { acompanhar(registro.installing); });

        // Força uma checagem agora e a cada 60 s (o app de campo fica aberto
        // muito tempo; sem isso o navegador só checaria de vez em quando).
        registro.update();
        setInterval(function () { registro.update(); }, 60000);
      }).catch(function (erro) {
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

  /* ============ Aviso de nova versão ============ */
  function mostrarAvisoAtualizacao(aoAtualizar) {
    const aviso = $('aviso-atualizacao');
    const botao = $('btn-atualizar');
    if (!aviso || !botao) return;
    aviso.classList.remove('oculto');
    botao.onclick = function () {
      botao.disabled = true;
      botao.textContent = 'Atualizando…';
      aoAtualizar();
    };
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
    EC.fluxo.iniciar();
  });
  $('btn-reembolso').addEventListener('click', function () {
    EC.reembolso.abrir();
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
  function fecharOverlay() {
    $('overlay').classList.add('oculto');
  }
  $('overlay-fechar').addEventListener('click', fecharOverlay);
  $('overlay').addEventListener('click', function (evento) {
    if (evento.target === $('overlay')) fecharOverlay();
  });

  // Histórico recente: monitoramentos FINALIZADOS dos últimos 30 dias. Os que
  // têm o registro completo guardado (loja 'registros' do IndexedDB) permitem
  // gerar/regerar o PDF — ex.: o técnico saiu da conclusão sem compartilhar.
  $('btn-historico').addEventListener('click', async function () {
    const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Registros completos (com fotos) + legado leve do localStorage (sem fotos).
    let completos = [];
    try { completos = (await EC.db.getAll('registros')) || []; } catch (e) { completos = []; }
    const porCod = {};
    completos.forEach(function (r) {
      if (r && r.codificacao) porCod[r.codificacao] = { reg: r, completo: true };
    });
    EC.storage.listar('historico:').forEach(function (item) {
      const r = item.valor || {};
      const cod = r.codificacao || item.chave.replace('historico:', '');
      if (!porCod[cod]) porCod[cod] = { reg: r, completo: false };
    });

    // Mantém só os últimos 30 dias; o que venceu é apagado do aparelho.
    let itens = Object.keys(porCod).map(function (cod) {
      return { cod: cod, reg: porCod[cod].reg, completo: porCod[cod].completo };
    }).filter(function (it) {
      const t = Date.parse(it.reg.salvoEm || '');
      if (t && t < limite) {
        if (EC.db && EC.db.disponivel()) EC.db.remove('registros', it.cod).catch(function () {});
        EC.storage.remover('historico:' + it.cod);
        return false;
      }
      return true;
    }).sort(function (a, b) {
      return String(b.reg.salvoEm || '').localeCompare(String(a.reg.salvoEm || ''));
    });
    const mapa = {}; itens.forEach(function (it) { mapa[it.cod] = it; });

    abrirOverlay('🕐 Histórico recente (últimos 30 dias)',
      (itens.length ? '<p class="texto-apoio">🔒 Serviço finalizado não pode ser editado — aqui você confere e baixa o PDF de novo.</p>' : '') +
      (itens.length ? '<label class="overlay-busca"><input type="search" id="hist-busca" placeholder="🔍 Buscar por OS, cliente ou projeto…" autocomplete="off"></label>' : '') +
      '<div id="hist-lista"></div>');

    const lista = $('hist-lista');
    function itemHtml(it) {
      const r = it.reg;
      const os = r.os || {};
      const data = r.salvoEm ? new Date(r.salvoEm).toLocaleString('pt-BR') : '';
      return '<div class="overlay-item">' +
        '<strong>OS ' + (os.numero || '?') + '</strong>' + (os.cliente ? ' — ' + os.cliente : '') +
        (os.projeto ? '<br><small>' + os.projeto + '</small>' : '') +
        '<br><small>' + ((r.servico && r.servico.escopo) || r.tipo || '') + (r.tecnico ? ' · ' + r.tecnico : '') + (data ? ' · ' + data : '') + '</small>' +
        (it.completo ? '' : '<br><small>⚠️ registro antigo — o PDF sai sem as fotos</small>') +
        '<div class="overlay-item-acoes">' +
        '<button type="button" class="botao botao-secundario hist-pdf" data-cod="' + it.cod + '">📄 Gerar PDF</button>' +
        '<button type="button" class="botao botao-perigo hist-excluir" data-cod="' + it.cod + '" title="Excluir do aparelho">🗑️</button>' +
        '</div></div>';
    }
    function render(filtro) {
      if (itens.length === 0) {
        lista.innerHTML = '<p class="overlay-vazio">Nenhum monitoramento finalizado nos últimos 30 dias.</p>';
        return;
      }
      const q = String(filtro || '').trim().toLowerCase();
      const vis = itens.filter(function (it) {
        const r = it.reg; const os = r.os || {};
        return !q || [os.numero, os.cliente, os.projeto, r.servico && r.servico.escopo, r.tecnico]
          .some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
      });
      lista.innerHTML = vis.length === 0
        ? '<p class="overlay-vazio">Nada encontrado para essa busca.</p>'
        : vis.map(itemHtml).join('');
      lista.querySelectorAll('.hist-pdf').forEach(function (b) {
        b.addEventListener('click', function () {
          const it = mapa[b.dataset.cod];
          if (!it) return;
          b.disabled = true;
          const rotulo = b.textContent;
          b.textContent = '⏳ Preparando…';
          // Se o PDF deste registro já foi gerado, compartilha o salvo (mantém
          // as fotos mesmo em registro legado); senão gera agora.
          const salvo = (EC.db && EC.db.disponivel())
            ? EC.db.get('pdfs', b.dataset.cod).catch(function () { return null; })
            : Promise.resolve(null);
          salvo.then(function (rec) {
            if (rec && rec.blob) return EC.pdf.abrirSalvo(rec);
            if (!EC.pdf || !EC.pdf.suporta(it.reg)) { mostrarToast('Não foi possível gerar o PDF deste registro.'); return; }
            return Promise.resolve(EC.pdf.gerar(it.reg));
          })
            .catch(function () { mostrarToast('Não foi possível gerar o PDF. Tente de novo.'); })
            .then(function () { b.disabled = false; b.textContent = rotulo; });
        });
      });
      lista.querySelectorAll('.hist-excluir').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Excluir este registro (e o PDF dele) do aparelho? (o que já foi enviado ao servidor não é afetado)')) return;
          const cod = b.dataset.cod;
          if (EC.db && EC.db.disponivel()) {
            EC.db.remove('registros', cod).catch(function () {});
            EC.db.remove('pdfs', cod).catch(function () {});
          }
          EC.storage.remover('historico:' + cod);
          itens = itens.filter(function (it) { return it.cod !== cod; });
          delete mapa[cod];
          const bu = $('hist-busca');
          render(bu ? bu.value : '');
        });
      });
    }
    const busca = $('hist-busca');
    if (busca) busca.addEventListener('input', function () { render(busca.value); });
    render('');
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
  async function atualizarBarraPendencias() {
    const barra = $('barra-pendencias');
    if (!sessaoAtual()) {
      barra.classList.add('oculto');
      return;
    }
    let pendentes = 0;
    try { pendentes = (await EC.db.keys('pending')).length; } catch (e) { /* ok */ }
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

  $('pendencias-ver').addEventListener('click', async function () {
    let chaves = [];
    try { chaves = await EC.db.keys('pending'); } catch (e) { /* ok */ }
    abrirOverlay('⏳ Pendentes de sincronização', chaves.length === 0
      ? '<p class="overlay-vazio">Nenhum registro pendente.</p>'
      : chaves.map(function (c) { return '<div class="overlay-item">' + c + '</div>'; }).join(''));
  });

  $('pendencias-sincronizar').addEventListener('click', function () {
    if (EC.sync) EC.sync.sincronizarPendentes();
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
  $('fase2-voltar').addEventListener('click', function () { mostrarTela('tela-acao'); });

  /* ============ Funções compartilhadas com os módulos de fluxo ============ */
  EC.app = {
    mostrarTela: mostrarTela,
    mostrarToast: mostrarToast,
    abrirOverlay: abrirOverlay,
    fecharOverlay: fecharOverlay
  };

  /* ============ Inicialização ============ */
  mostrarVersao();
  if (sessaoAtual()) {
    entrarNoApp();
  } else {
    prepararLogin();
  }
})();
