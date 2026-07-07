/**
 * auth.js — Login por e-mail e senha (a MESMA conta do SGP)
 *
 * O e-CAMP entra com a conta criada pelo administrador na tela de Usuários do
 * SGP (Supabase Auth). Nada de cadastro por fora: se o admin não criou a conta,
 * a pessoa não entra.
 *
 * A senha é gerida pelo admin no SGP (tela Usuários): senha inicial padrão
 * campo26*, redefinida quando a pessoa pedir. O e-CAMP só valida e-mail + senha
 * e entra direto — sem obrigar a criar senha própria.
 *
 * Regra espelhada do SGP: conta desativada (usuarios.ativo = false) → não entra.
 *
 * O primeiro acesso precisa de internet. Depois, a sessão fica guardada no
 * aparelho e o app continua abrindo offline como sempre.
 *
 * Expõe EC.auth = { entrar, sair }
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yrelenpozorlekbuvhkl.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_IvEFvdEXmHT5gW3mWIFx-g_6H0FGlvS'; // chave pública (a segurança é o RLS do banco)

  var cliente = null;
  function obterCliente() {
    if (!cliente && window.supabase && window.supabase.createClient) {
      cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return cliente;
  }

  function erroAmigavel(mensagem) {
    var m = String(mensagem || '');
    if (m.indexOf('Invalid login credentials') !== -1) return '🛑 E-mail ou senha incorretos. Verifique e tente novamente.';
    if (m.indexOf('Email not confirmed') !== -1) return '🛑 Esta conta ainda não foi liberada. Fale com o administrador.';
    if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1 || m.indexOf('Load failed') !== -1) {
      return '📡 Sem conexão com o servidor. O primeiro acesso precisa de internet.';
    }
    return '🛑 Não foi possível entrar: ' + m;
  }

  /**
   * Entra com e-mail e senha. Devolve { nome, email }.
   * Em caso de problema, lança Error com mensagem pronta para a tela.
   */
  async function entrar(email, senha) {
    var sb = obterCliente();
    if (!sb) throw new Error('🛑 O componente de login não carregou. Feche e abra o app com internet.');

    var r = await sb.auth.signInWithPassword({ email: email, password: senha })
      .catch(function (e) { return { error: e }; });
    if (r.error) throw new Error(erroAmigavel(r.error.message));

    var user = r.data.user;
    var nome = (user.email || email).split('@')[0];

    // Nome e situação da conta — mesma tabela de usuários do SGP.
    var q = await sb.from('usuarios').select('nome, ativo').eq('id', user.id).single()
      .catch(function () { return { data: null }; });
    if (q && q.data) {
      if (q.data.ativo === false) {
        await sb.auth.signOut().catch(function () {});
        throw new Error('🚫 Seu acesso foi desativado. Fale com o administrador do sistema.');
      }
      if (q.data.nome) nome = q.data.nome;
    }

    return { nome: nome, email: user.email || email };
  }

  /** Sai da conta (ignora falhas de rede — a sessão local é apagada pelo app). */
  async function sair() {
    var sb = obterCliente();
    if (sb) await sb.auth.signOut().catch(function () {});
  }

  window.EC = window.EC || {};
  EC.auth = { entrar: entrar, sair: sair };
})();
