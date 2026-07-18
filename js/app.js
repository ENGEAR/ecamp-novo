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

  const CHAVE_SESSAO = 'sessao:atual';
  const CHAVE_ULTIMO_EMAIL = 'sessao:ultimoEmail';
  // E-mail + senha salvos no aparelho quando a pessoa marca "Salvar e-mail e
  // senha" — fica em texto puro no localStorage do aparelho (não é enviado a
  // lugar nenhum). Opt-in explícito: só grava se a pessoa marcar a caixinha.
  const CHAVE_CREDENCIAIS = 'sessao:credenciais';
  // Fallback exibido antes do cache responder; bump junto com VERSAO_CACHE no SW.
  const VERSAO_APP = '0.58.71';

  function $(id) { return document.getElementById(id); }

  /* ============ Armazenamento PERSISTENTE (não perder histórico) ============ */
  // Pede ao navegador para NÃO descartar os dados do app (IndexedDB + localStorage:
  // histórico recente, rascunhos, fila offline). Sem isso, o navegador/OS pode
  // "evictar" tudo numa atualização/reinstalação ou por falta de espaço — que é
  // exatamente o que fazia o Histórico recente sumir. É idempotente: se já está
  // persistente, não faz nada. Precisa de gesto/engajamento em alguns navegadores,
  // então também tentamos de novo no primeiro toque do usuário.
  function garantirPersistencia() {
    if (!(navigator.storage && navigator.storage.persist)) return;
    navigator.storage.persisted().then(function (jaOk) {
      if (jaOk) return;
      navigator.storage.persist().then(function (ok) {
        if (!ok) {
          console.warn('eCamp: armazenamento persistente ainda NÃO concedido — tentaremos de novo.');
          // 2ª tentativa após um gesto do usuário (alguns navegadores exigem).
          const retry = function () {
            navigator.storage.persist().finally(function () {
              document.removeEventListener('click', retry, true);
            });
          };
          document.addEventListener('click', retry, true);
        }
      }).catch(function () { /* API pode falhar em modo privado; ignora */ });
    }).catch(function () { /* ignora */ });
  }

  /* ============ Versão no rodapé ============ */
  // Mostra a versão REAL: lê o nome do cache ativo do service worker (ecamp-vX.Y.Z).
  // Assim dá para conferir no celular se está na última versão. Se o app estiver
  // preso numa versão antiga, aparece a versão antiga aqui — o que já denuncia.
  function mostrarVersao() {
    const rodape = $('rodape');
    if (!rodape) return;
    // Texto curto de propósito: cabe numa linha só mesmo em telas estreitas —
    // o rodapé fica menor e o espaço reservado pra ele (CSS) não precisa
    // "adivinhar" quantas linhas vão aparecer em cada aparelho.
    const base = 'eCamp ENGEAR Laboratório · versão ';
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

  /* ============ Sessão / Login (e-mail e senha — mesma conta do SGP) ============ */
  function sessaoAtual() { return EC.storage.ler(CHAVE_SESSAO); }

  // Iniciais do nome (ex.: "Raisa Sant'Ana" → "RS") — o nome completo não
  // cabe no chip do cabeçalho em telas estreitas e desconfigurava o layout.
  function iniciaisNome(nome) {
    const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
  }

  function entrarNoApp() {
    const sessao = sessaoAtual();
    $('chip-avatar').textContent = iniciaisNome(sessao.nome);
    $('chip-avatar').title = sessao.nome;
    $('header').classList.remove('oculto');
    atualizarBarraPendencias();
    // Sino de aprovações: aparece só para quem tem papel logística/admin.
    if (EC.aprovacoes && EC.aprovacoes.atualizarBadge) EC.aprovacoes.atualizarBadge();
    // Lembrete de serviço agendado: aparece automaticamente p/ quem é técnico (casado pelo e-mail).
    if (EC.agenda && EC.agenda.carregarLembretes) EC.agenda.carregarLembretes();
    // SGQ: avisa no sino se há documento para baixar (ou com versão nova).
    if (EC.biblioteca && EC.biblioteca.atualizarSino) EC.biblioteca.atualizarSino();
    // Extrato geral (todas as solicitações): só Financeiro/Logística/admin.
    var pap = sessao.papeis || [];
    var ehGestor = pap.indexOf('financeiro') !== -1 || pap.indexOf('logistica') !== -1 || pap.indexOf('admin') !== -1;
    $('btn-extrato-geral').classList.toggle('oculto', !ehGestor);
    mostrarTela('tela-acao');
  }

  function prepararLogin() {
    $('header').classList.add('oculto');
    $('barra-pendencias').classList.add('oculto');
    $('login-erro').classList.add('oculto');
    const salvas = EC.storage.ler(CHAVE_CREDENCIAIS);
    if (salvas && salvas.email) {
      $('login-email').value = salvas.email;
      $('login-senha').value = salvas.senha || '';
      $('login-salvar').checked = true;
    } else {
      $('login-email').value = EC.storage.ler(CHAVE_ULTIMO_EMAIL) || '';
      $('login-senha').value = '';
      $('login-salvar').checked = false;
    }
    mostrarTela('tela-login');
  }

  function mostrarErroLogin(elemento, mensagem) {
    const erro = $(elemento);
    erro.textContent = mensagem;
    erro.classList.remove('oculto');
  }

  // Guarda a sessão do app (o supabase-js guarda a dele por conta própria).
  function salvarSessao(conta) {
    EC.storage.salvar(CHAVE_SESSAO, {
      nome: conta.nome,
      email: conta.email,
      papeis: conta.papeis || [],   // papéis do SGP (ex.: logistica) — liberam extras
      entrouEm: new Date().toISOString()
    });
    EC.storage.salvar(CHAVE_ULTIMO_EMAIL, conta.email);
  }

  $('form-login').addEventListener('submit', async function (evento) {
    evento.preventDefault();
    $('login-erro').classList.add('oculto');
    const email = $('login-email').value.trim().toLowerCase();
    const senha = $('login-senha').value;
    const botao = $('login-entrar');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      // Entra direto com e-mail + senha. A senha é gerida pelo admin no SGP
      // (inicial padrão campo26*; redefinida quando a pessoa pedir).
      const conta = await EC.auth.entrar(email, senha);
      salvarSessao(conta);
      if ($('login-salvar').checked) EC.storage.salvar(CHAVE_CREDENCIAIS, { email: email, senha: senha });
      else EC.storage.remover(CHAVE_CREDENCIAIS);
      entrarNoApp();
    } catch (e) {
      mostrarErroLogin('login-erro', e.message);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  // "Mostrar senha"
  $('login-ver-senha').addEventListener('change', function () {
    $('login-senha').type = this.checked ? 'text' : 'password';
  });

  /* ============ Menu da conta (iniciais → Ajuda / Sair) ============ */
  function fecharMenuConta() {
    $('menu-conta').classList.add('oculto');
    $('chip-usuario').setAttribute('aria-expanded', 'false');
  }
  function alternarMenuConta() {
    var aberto = !$('menu-conta').classList.contains('oculto');
    if (aberto) { fecharMenuConta(); return; }
    $('menu-conta').classList.remove('oculto');
    $('chip-usuario').setAttribute('aria-expanded', 'true');
  }
  $('chip-usuario').addEventListener('click', function (e) {
    e.stopPropagation();
    alternarMenuConta();
  });
  // Fecha ao tocar fora do menu ou apertar Esc.
  document.addEventListener('click', function (e) {
    if ($('menu-conta').classList.contains('oculto')) return;
    if (!$('menu-conta').contains(e.target) && e.target !== $('chip-usuario') && !$('chip-usuario').contains(e.target)) fecharMenuConta();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharMenuConta(); });

  $('menu-ajuda').addEventListener('click', function () {
    fecharMenuConta();
    if (EC.ajuda && EC.ajuda.abrir) EC.ajuda.abrir();
  });
  $('menu-sair').addEventListener('click', function () {
    fecharMenuConta();
    if (confirm('Sair do eCamp?')) {
      EC.storage.remover(CHAVE_SESSAO);
      EC.auth.sair();
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
    EC.agenda.abrir();
  });
  $('btn-extrato-geral').addEventListener('click', function () {
    if (EC.reembolso && EC.reembolso.extratoGeral) EC.reembolso.extratoGeral();
  });

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

  // Rascunhos: OS/serviços que foram INICIADOS e interrompidos (não finalizados),
  // dos últimos 30 dias. Só os rascunhos de serviço ('rascunho:fluxo_...') entram
  // — o 'rascunho:os_...' é só dado compartilhado da OS, não um serviço em aberto.
  // Tocar num item reabre o serviço para continuar.
  $('btn-rascunhos').addEventListener('click', function () {
    const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const itens = EC.storage.listar('rascunho:fluxo_')
      .map(function (item) { return item.valor || {}; })
      .filter(function (e) {
        const t = Date.parse(e.atualizadoEm || '');
        return t && t >= limite; // só os iniciados nos últimos 30 dias
      })
      .sort(function (a, b) {
        return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || ''));
      });

    abrirOverlay('📝 Rascunhos (últimos 30 dias)', itens.length === 0
      ? '<p class="overlay-vazio">Nenhuma OS iniciada e interrompida nos últimos 30 dias.</p>'
      : '<p class="texto-apoio">Serviços começados e ainda não finalizados. Toque para continuar de onde parou.</p>' +
        '<div id="rasc-lista">' + itens.map(function (e) {
          const os = e.os || {};
          const data = e.atualizadoEm ? new Date(e.atualizadoEm).toLocaleString('pt-BR') : '';
          return '<div class="overlay-item overlay-item-clicavel" data-os="' + (e.osNumero || '') + '" data-indice="' + (e.servicoIndice != null ? e.servicoIndice : '') + '">' +
            '<strong>OS ' + (os.numero || e.osNumero || '?') + '</strong>' + (os.cliente ? ' — ' + os.cliente : '') +
            (os.projeto ? '<br><small>' + os.projeto + '</small>' : '') +
            '<br><small>' + ((e.servico && e.servico.escopo) || '') + (data ? ' · último salvamento ' + data : '') + '</small>' +
            '</div>';
        }).join('') + '</div>');

    const lista = $('rasc-lista');
    if (lista) lista.querySelectorAll('.overlay-item-clicavel').forEach(function (el) {
      el.addEventListener('click', function () {
        const numero = el.dataset.os;
        const indice = parseInt(el.dataset.indice, 10);
        if (!numero || isNaN(indice)) return;
        fecharOverlay();
        if (EC.fluxo && EC.fluxo.continuarRascunho) EC.fluxo.continuarRascunho(numero, indice);
      });
    });
  });

  $('btn-agenda').addEventListener('click', function () {
    EC.agenda.abrir();
  });

  $('btn-biblioteca').addEventListener('click', function () {
    if (EC.biblioteca && EC.biblioteca.abrir) EC.biblioteca.abrir();
    else abrirOverlay('📚 Biblioteca', '<p class="overlay-vazio">Biblioteca indisponível.</p>');
  });

  /* ============ Sino único (Aprovações + Lembretes + SGQ) ============ */
  // Cada módulo (aprovacoes.js, agenda.js, biblioteca.js) reporta sua própria
  // contagem aqui — um só sino, um só total. Se só UMA fonte tiver conteúdo,
  // vai direto pra ela (sem etapa no meio, igual sempre foi); com mais de uma
  // ao mesmo tempo, mostra as listas JÁ ABERTAS no mesmo lugar — sem precisar
  // escolher primeiro.
  const sinoContagens = { aprovacoes: 0, lembretes: 0, sgq: 0 };
  const sinoMostrarSempre = { aprovacoes: false }; // aprovações aparece p/ quem tem o papel, mesmo com 0
  function atualizarSino(chave, n, mostrarSempre) {
    sinoContagens[chave] = n;
    if (mostrarSempre !== undefined) sinoMostrarSempre[chave] = mostrarSempre;
    const total = sinoContagens.aprovacoes + sinoContagens.lembretes + sinoContagens.sgq;
    const algumaFonteRelevante = sinoMostrarSempre.aprovacoes || total > 0;
    const botao = $('btn-aprovacoes');
    botao.classList.toggle('oculto', !algumaFonteRelevante);
    const badge = $('sino-badge');
    if (total > 0) { badge.textContent = total > 99 ? '99+' : String(total); badge.classList.remove('oculto'); }
    else badge.classList.add('oculto');
  }

  async function abrirMenuSino() {
    const querAprov = sinoMostrarSempre.aprovacoes;
    const querLemb = sinoContagens.lembretes > 0;
    const querSgq = sinoContagens.sgq > 0;
    const fontes = (querAprov ? 1 : 0) + (querLemb ? 1 : 0) + (querSgq ? 1 : 0);
    if (fontes === 0) return;
    if (fontes === 1) {
      if (querAprov && EC.aprovacoes && EC.aprovacoes.abrir) EC.aprovacoes.abrir();
      else if (querLemb && EC.agenda && EC.agenda.abrirVistos) EC.agenda.abrirVistos();
      else if (querSgq && EC.biblioteca && EC.biblioteca.abrir) EC.biblioteca.abrir();
      return;
    }

    // As duas fontes têm conteúdo ao mesmo tempo: mostra as listas de verdade,
    // já abertas — sem obrigar a escolher uma categoria antes de ver o quê.
    abrirOverlay('🔔 Pendências', '<p class="texto-apoio">Carregando…</p>');
    const partes = [];
    if (querAprov && EC.aprovacoes && EC.aprovacoes.obterPendentesParaSino) {
      const pend = await EC.aprovacoes.obterPendentesParaSino();
      // Separa por status: aprovar (logística) vs pagar (financeiro) — cada um
      // no seu título, pra não misturar "aguardando pagamento" com aprovação.
      const aAprovar = pend.filter(function (s) { return s.status === 'aguardando_logistica'; });
      const aPagar = pend.filter(function (s) { return s.status === 'aguardando_pagamento'; });
      const listar = function (itens) { return itens.map(function (s) { return EC.aprovacoes.cartaoHtml(s); }).join(''); };
      if (aAprovar.length) {
        partes.push('<p class="dg-secao">🔧 Aprovações de logística (' + aAprovar.length + ')</p>' + listar(aAprovar));
      }
      if (aPagar.length) {
        partes.push('<p class="dg-secao">💰 Pendências de Pagamento (' + aPagar.length + ')</p>' + listar(aPagar));
      }
      if (!aAprovar.length && !aPagar.length) {
        partes.push('<p class="dg-secao">🔧 Aprovações de logística (0)</p><p class="texto-apoio">Nada pendente.</p>');
      }
    }
    if (querLemb && EC.agenda && EC.agenda.obterVistosParaSino) {
      partes.push('<p class="dg-secao">📅 Lembretes de serviço (' + sinoContagens.lembretes + ')</p>' +
        '<p class="texto-apoio">Você tem os seguintes serviços agendados:</p>' + EC.agenda.obterVistosParaSino());
    }
    if (querSgq) {
      const n = sinoContagens.sgq;
      partes.push('<p class="dg-secao">📚 Biblioteca (' + n + ')</p>' +
        '<div class="overlay-item sino-sgq" role="button" tabindex="0">📥 ' + n + ' documento(s) para baixar ou atualizar no aparelho — toque para abrir a Biblioteca.</div>');
    }
    $('overlay-conteudo').innerHTML = partes.join('');
    const itemSgq = document.querySelector('#overlay-conteudo .sino-sgq');
    if (itemSgq) itemSgq.addEventListener('click', function () {
      fecharOverlay();
      if (EC.biblioteca && EC.biblioteca.abrir) EC.biblioteca.abrir();
    });
    document.querySelectorAll('#overlay-conteudo .apr-cartao[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        fecharOverlay();
        if (EC.aprovacoes && EC.aprovacoes.abrirItemDireto) EC.aprovacoes.abrirItemDireto(el.dataset.id);
      });
    });
    if (querLemb && EC.agenda && EC.agenda.ligarCliqueVaiAgenda) EC.agenda.ligarCliqueVaiAgenda();
  }

  $('btn-aprovacoes').addEventListener('click', abrirMenuSino);

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
    // Voltou a internet: reconfere na API se há documento novo do SGQ.
    if (sessaoAtual() && EC.biblioteca && EC.biblioteca.atualizarSino) EC.biblioteca.atualizarSino();
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

  /* ============ Botões de voltar dos placeholders ============ */
  $('fase2-voltar').addEventListener('click', function () { mostrarTela('tela-acao'); });

  /* ============ Funções compartilhadas com os módulos de fluxo ============ */
  EC.app = {
    mostrarTela: mostrarTela,
    mostrarToast: mostrarToast,
    atualizarSino: atualizarSino,
    abrirOverlay: abrirOverlay,
    fecharOverlay: fecharOverlay
  };

  /* ============ Inicialização ============ */
  garantirPersistencia();
  mostrarVersao();
  if (EC.agenda) EC.agenda._ligar();
  // Limpeza da época do login antigo (nome + senha única do app).
  EC.storage.remover('sessao:senhaSalva');
  const sessao = sessaoAtual();
  if (sessao && sessao.email) {
    // Sessão por e-mail válida: entra direto (funciona offline).
    entrarNoApp();
  } else {
    // Sem sessão, ou sessão do formato antigo (sem e-mail): pede o novo login.
    if (sessao) EC.storage.remover(CHAVE_SESSAO);
    prepararLogin();
  }
})();
