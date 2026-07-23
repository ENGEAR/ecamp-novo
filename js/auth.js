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
 * E não basta barrar no login: quem sai da empresa também perde o app JÁ ABERTO
 * no aparelho. Por isso existe `revalidar()`, que o app chama a cada abertura
 * com internet para derrubar a sessão de uma conta desativada.
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
    // Primeiro acesso: a conta foi criada/redefinida pelo admin com senha temporária.
    // A pessoa é obrigada a criar a própria senha (mesma regra do SGP).
    var senhaTemporaria = !!(user.user_metadata && user.user_metadata.senha_temporaria === true);

    // Nome e situação da conta — mesma tabela de usuários do SGP.
    // A consulta do Supabase é "thenable" mas NÃO tem .catch; por isso usamos
    // try/await. Sem linha, ela resolve com data:null (não estoura).
    var perfil = null;
    try {
      var q = await sb.from('usuarios').select('nome, ativo').eq('id', user.id).single();
      perfil = (q && q.data) ? q.data : null;
    } catch (e) {
      perfil = null; // falha ao ler o perfil não impede o login
    }
    if (perfil) {
      if (perfil.ativo === false) {
        await sb.auth.signOut().catch(function () {});
        throw new Error('🚫 Seu acesso foi desativado. Fale com o administrador do sistema.');
      }
      if (perfil.nome) nome = perfil.nome;
    }

    return { nome: nome, email: user.email || email, papeis: await meusPapeis(), senhaTemporaria: senhaTemporaria };
  }

  /**
   * Troca a senha do usuário logado e desliga a marca de senha temporária.
   * Usado no primeiro acesso (obrigatório). Exige internet.
   */
  async function trocarSenha(novaSenha) {
    var sb = obterCliente();
    if (!sb) throw new Error('🛑 Sem conexão para salvar a nova senha. Tente com internet.');
    var r = await sb.auth.updateUser({ password: novaSenha, data: { senha_temporaria: false } })
      .catch(function (e) { return { error: e }; });
    if (r.error) {
      var m = String(r.error.message || '');
      if (m.indexOf('different from the old') !== -1) return Promise.reject(new Error('A nova senha precisa ser diferente da temporária.'));
      if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1 || m.indexOf('Load failed') !== -1) return Promise.reject(new Error('📡 Sem conexão para salvar a nova senha.'));
      return Promise.reject(new Error('Não foi possível salvar a nova senha: ' + m));
    }
  }

  /**
   * Papéis do usuário logado (ex.: ['logistica'] ou ['admin']). Vazio se não
   * der para consultar (offline/erro) — os módulos tratam como "sem extras".
   */
  async function meusPapeis() {
    var sb = obterCliente();
    if (!sb) return [];
    try {
      var u = await sb.auth.getUser();
      var id = u && u.data && u.data.user ? u.data.user.id : null;
      if (!id) return [];
      var q = await sb.from('usuario_papeis').select('papeis(codigo)').eq('usuario_id', id);
      return (q.data || []).map(function (r) {
        return r.papeis && r.papeis.codigo ? r.papeis.codigo : null;
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  /**
   * Reconfere a conta NO SERVIDOR (precisa de internet). É o que garante que
   * quem foi desligado da empresa perde o app no aparelho — antes, a conta só
   * era conferida no LOGIN, e quem já estava logado seguia usando para sempre.
   *
   * Devolve:
   *   'ok'         — conta existe e está ativa
   *   'desativado' — usuarios.ativo = false (pessoa desligada/bloqueada)
   *   'semSessao'  — o servidor recusou a sessão (login banido, senha trocada…)
   *   'indefinido' — NÃO deu para conferir (offline, servidor fora, erro de rede)
   *
   * REGRA DE OURO: só 'desativado'/'semSessao' derrubam alguém, e ambos vêm de
   * uma resposta EXPLÍCITA do servidor. Falta de internet nunca desloga — o app
   * é offline-first e o técnico não pode perder o acesso no meio do campo.
   */
  async function revalidar() {
    var sb = obterCliente();
    if (!sb) return 'indefinido';
    if (navigator && navigator.onLine === false) return 'indefinido';

    var u;
    try {
      u = await sb.auth.getUser();
    } catch (e) {
      return 'indefinido'; // exceção de rede
    }
    if (u && u.error) {
      // Erro COM status HTTP 4xx = o servidor respondeu e recusou (sessão morta,
      // conta banida). Sem status (ou 5xx) = rede/servidor: não derruba.
      var st = u.error.status || 0;
      return (st >= 400 && st < 500) ? 'semSessao' : 'indefinido';
    }
    var user = u && u.data ? u.data.user : null;
    if (!user) return 'semSessao'; // sessão não existe mais no servidor

    // Situação da conta — mesma checagem do login.
    try {
      var q = await sb.from('usuarios').select('ativo').eq('id', user.id).single();
      if (q && q.data && q.data.ativo === false) return 'desativado';
      if (q && q.error) return 'indefinido'; // não conseguiu ler: não derruba
    } catch (e) {
      return 'indefinido';
    }
    return 'ok';
  }

  /** Sai da conta (ignora falhas de rede — a sessão local é apagada pelo app). */
  async function sair() {
    var sb = obterCliente();
    if (sb) await sb.auth.signOut().catch(function () {});
  }

  window.EC = window.EC || {};
  // cliente: outros módulos (ex.: Agenda) usam a MESMA conexão autenticada.
  EC.auth = { entrar: entrar, sair: sair, cliente: obterCliente, meusPapeis: meusPapeis, trocarSenha: trocarSenha, revalidar: revalidar };
})();
