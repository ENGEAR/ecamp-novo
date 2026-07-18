/**
 * ajuda.js — Ajuda embutida no app ("Como usar o e-CAMP")
 *
 * Abre pelo menu da conta (toque nas iniciais → Ajuda). Mostra o passo a passo
 * do app em tópicos que abrem e fecham (accordion nativo <details>), com texto
 * enxuto — funciona offline, sem imagens, pra não pesar no PWA.
 *
 * Expõe EC.ajuda = { abrir }
 */
window.EC = window.EC || {};

EC.ajuda = (function () {
  'use strict';

  // Um tópico do accordion. `corpo` é HTML (lista de passos etc.).
  function topico(titulo, corpo) {
    return '<details class="ajuda-topico"><summary>' + titulo + '</summary>' +
      '<div class="ajuda-corpo">' + corpo + '</div></details>';
  }
  function secao(t) { return '<p class="ajuda-secao">' + t + '</p>'; }
  function ol(itens) { return '<ol>' + itens.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ol>'; }
  function ul(itens) { return '<ul>' + itens.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'; }

  function html() {
    // Papéis do usuário (mesmo critério do botão "Extrato geral" no app.js):
    // a linha do Extrato geral só aparece para Financeiro / Logística / admin.
    var pap = ((EC.storage && EC.storage.ler('sessao:atual')) || {}).papeis || [];
    var ehGestor = pap.indexOf('financeiro') !== -1 || pap.indexOf('logistica') !== -1 || pap.indexOf('admin') !== -1;
    var telaInicial = [
      '<strong>🛠️ Serviços</strong> — registrar um monitoramento em campo.',
      '<strong>💰 Solicitação de reembolso</strong>.',
      '<strong>📅 Agenda</strong> — a sua programação.'
    ];
    if (ehGestor) telaInicial.push('<strong>🧾 Extrato geral</strong> — todas as solicitações (Financeiro / Logística).');
    return (
      '<p class="ajuda-intro">Toque num tópico para abrir o passo a passo. Vale para o técnico de campo.</p>' +

      secao('Primeiros passos') +
      topico('📲 Instalar no celular', ul([
        '<strong>Android (Chrome):</strong> menu ⋮ → “Adicionar à tela de início”.',
        '<strong>iPhone (Safari):</strong> botão Compartilhar → “Adicionar à Tela de Início”.',
        'O <strong>primeiro acesso precisa de internet</strong>; depois o app abre e funciona offline.'
      ])) +
      topico('▶️ Entrar no app', ul([
        'Use o seu <strong>e-mail corporativo</strong> (@engearlaboratorio.com.br) se for funcionário efetivo da empresa. Em caso de <strong>freelancer</strong>, use o e-mail informado para a ENGEAR.',
        'Marque <strong>“Salvar e-mail e senha”</strong> para não digitar toda vez.',
        'Esqueceu a senha? Peça ao administrador para redefinir (a senha é gerida por ele).',
        'Conta desativada não entra — fale com o administrador.'
      ])) +
      topico('🏠 Tela inicial', ul(telaInicial)) +

      secao('A barra do topo') +
      topico('🔝 O que faz cada ícone', ul([
        '🔔 <strong>Avisos e aprovações</strong> — pagamentos de reembolso, lembretes de serviço e outros avisos.',
        '🕐 <strong>Histórico</strong> — serviços finalizados (últimos 30 dias).',
        '📝 <strong>Rascunhos</strong> — serviços começados e não finalizados.',
        '📅 <strong>Agenda</strong> — a sua programação.',
        '📚 <strong>Biblioteca</strong> — normas e procedimentos.',
        '<strong>Suas iniciais</strong> — abre <em>Ajuda</em> e <em>Sair</em>.',
        'O <strong>logo</strong> volta para a tela inicial.'
      ])) +

      secao('Fazer um serviço (campo)') +
      topico('🛠️ Passo a passo (1 a 10)', ol([
        '<strong>Escolher a OS</strong> — busque por número ou cliente.',
        '<strong>Serviços da OS</strong> — se houver vários, escolha um (🔒 libera após a campanha anterior).',
        '<strong>Dados gerais</strong> — só leitura; o único editável é o nº de pontos (se mudar, justifique).',
        '<strong>Tipo de monitoramento</strong> — já vem definido pelo escopo da OS.',
        '<strong>Equipamentos</strong> — ao menos um de cada categoria; calibração vencida fica bloqueada.',
        '<strong>Pré-campo / romaneio</strong> — confira o checklist antes de sair do laboratório.',
        '<strong>Preparação concluída</strong> — toque em “Ir para o campo”.',
        '<strong>Em campo</strong> — ponto a ponto: GPS, hora, checagens, fotos e condições.',
        '<strong>Revisão</strong> — 🟡 em branco não bloqueia · 🔴 obrigatório impede salvar.',
        '<strong>Finalizar</strong> — “Salvar registro”. O <strong>PDF é gerado</strong> e pode ser encaminhado no WhatsApp.'
      ])) +
      topico('🧭 Tipos de serviço', '<p class="texto-apoio">Cada tipo tem o seu formulário, mas a lógica é a mesma (pontos → GPS → checagens → fotos → condições).</p>' + ul([
        '<strong>Ruído</strong> — externo, interno, ferroviário e aeronáutico.',
        '<strong>Vibração</strong> (Sismografia).',
        '<strong>QAR Externo</strong> e <strong>QAR Interno</strong>.',
        '<strong>Opacidade</strong>.'
      ])) +
      topico('📝 Rascunho: continuar, reiniciar ou descartar', ul([
        'Ao reabrir um serviço já começado, o app pergunta o que fazer:',
        '<strong>✏️ Continuar</strong> — retoma de onde parou.',
        '<strong>🔄 Reiniciar</strong> — começa do zero.',
        '<strong>🗑️ Descartar</strong> — apaga o que foi preenchido.',
        'Os serviços em aberto também aparecem em 📝 <strong>Rascunhos</strong>, no topo.'
      ])) +
      topico('🕐 Histórico e refazer o PDF', ul([
        'Mostra os serviços <strong>finalizados dos últimos 30 dias</strong>.',
        '🔒 Um serviço finalizado não pode ser editado.',
        '<strong>📄 Gerar PDF</strong> — baixa o PDF de novo (ex.: saiu sem compartilhar).',
        '<strong>🗑️ Excluir</strong> — remove do aparelho (o que já foi enviado não é afetado).'
      ])) +
      topico('📡 Sem internet (offline)', ul([
        'O app foi feito para o campo — <strong>funciona offline</strong>.',
        'A barra do topo avisa “📡 Sem conexão” e quantos registros faltam sincronizar.',
        'Preencha e salve normalmente, sem internet.',
        'Quando a conexão volta, toque em <strong>🔄 Sincronizar</strong> (ou sobe sozinho).'
      ])) +

      secao('Solicitar reembolso') +
      topico('💰 Como solicitar', ol([
        'Reembolso → <strong>Nova solicitação</strong> (precisa de internet — os dados vêm da Agenda).',
        'Busque e escolha a <strong>OS</strong> e o <strong>designado</strong>.',
        'Escolha o <strong>tipo</strong> e preencha os campos.',
        'Anexe os <strong>comprovantes</strong> (📷 foto · 🖼️ galeria · 📎 PDF) e envie.'
      ])) +
      topico('🧳 Tipos de reembolso', ul([
        '<strong>Viagem</strong> — datas, transporte, distância, combustível, pedágio e valores.',
        '<strong>Eventos</strong> — pagamento por diárias do evento.',
        '<strong>Veículos</strong> — abastecimento, peças e manutenção.',
        '<strong>Complemento</strong> — aparece quando a OS já está 100% paga (paga o combustível dos km a mais).'
      ])) +
      topico('📊 Acompanhar o status', ul([
        'Em <strong>“Minhas solicitações”</strong> cada pedido mostra o status:',
        '⏳ Aguardando aprovação da Logística → ✅ Aguardando pagamento → 💰 Pago.',
        'Toque numa solicitação para ver o <strong>extrato</strong> (valores, parcelas e comprovantes).'
      ])) +
      topico('➕ Saldo, adiantamento, ajuste e editar', ul([
        '<strong>Saldo pendente</strong> — se pediu menos de 100%, peça o que faltou (botão “💠 Serviços com saldo pendente”).',
        '<strong>Adiantamento</strong> — marque “Sim” e informe data e valor; o app desconta do total.',
        '<strong>Ajuste</strong> — não concorda com um valor? Marque “Solicitar ajuste” com a justificativa.',
        '<strong>Editar</strong> — corrija uma solicitação já enviada (as fotos precisam ser anexadas de novo).'
      ])) +

      secao('Agenda') +
      topico('📅 Ver a sua programação', ul([
        'Alterne entre <strong>Mês</strong>, <strong>Semana</strong> e <strong>Lista</strong>.',
        'Filtre por status e por técnico.',
        'Toque num dia para ver os agendamentos dele.',
        'Os <strong>lembretes</strong> de serviço aparecem no 🔔 do topo.'
      ])) +

      '<p class="ajuda-rodape">e-CAMP · ENGEAR Laboratório — dúvidas ou algo travado? Fale com a Logística.</p>'
    );
  }

  function abrir() {
    if (!(EC.app && EC.app.abrirOverlay)) return;
    EC.app.abrirOverlay('❓ Ajuda — como usar o e-CAMP', html());
  }

  return { abrir: abrir };
})();
