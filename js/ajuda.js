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
      '<label class="overlay-busca"><input type="search" id="ajuda-busca" placeholder="🔍 Buscar na ajuda…" autocomplete="off"></label>' +
      '<p class="texto-apoio oculto" id="ajuda-vazio">Nada encontrado para essa busca.</p>' +

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
      topico('📚 Biblioteca', '<p>Assim que acessar o e-CAMP pela primeira vez, abra o menu <strong>Biblioteca</strong> e faça o download de todos os arquivos.</p>' +
        '<div class="alerta alerta-amarelo">🚨 <strong>Atenção:</strong> esta etapa é indispensável — é ela que garante o acesso às normas e procedimentos de referência para a execução dos serviços. Sempre que um documento é atualizado, você recebe uma notificação no sininho (🔔) avisando que há novos arquivos para baixar. Fique atento.</div>') +

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
        '<strong>Escolher a OS</strong> — busque pelo número ou cliente do serviço que você está designado a fazer.',
        '<strong>Serviços da OS</strong> — alguns serviços contemplam vários escopos. Neste caso, escolha o que foi designado a fazer. Só a campanha vigente fica liberada; campanhas posteriores ficam travadas (🔒) e são liberadas após a campanha anterior finalizar.',
        '<strong>Dados gerais</strong> — inclui todos os dados da OS, como informação do cliente, escopo, metodologia e procedimentos aplicáveis. Esta página é apenas de leitura; os únicos editáveis são o nº de pontos (se mudar, justifique) e a inclusão do link do Maps.',
        '<strong>Tipo de monitoramento</strong> — já vem definido pelo escopo da OS.',
        '<strong>Equipamentos</strong> — escolha os equipamentos que irá levar para campo. É necessário preencher ao menos um de cada categoria; equipamentos com calibração vencida ficam bloqueados.',
        '<strong>Pré-campo / romaneio</strong> — confira o checklist antes de sair do laboratório.',
        '<strong>Preparação concluída</strong> — toque em “Ir para o campo”.',
        '<strong>Em campo</strong> — ponto a ponto: GPS, hora, checagens, fotos e condições.',
        '<strong>Revisão</strong> — oportunidade de revisar o preenchimento. O ícone 🟡 significa que dados em branco não bloqueiam a opção de salvar · O ícone 🔴 indica que a informação é de preenchimento obrigatório, o que impede salvar.',
        '<strong>Finalizar</strong> — “Salvar registro”. O <strong>PDF é gerado</strong> e deve ser encaminhado no WhatsApp imediatamente para o diretor técnico ou grupo designado ao envio de informações.'
      ])) +
      topico('🧭 Tipos de serviço', '<p class="texto-apoio">Cada tipo tem o seu formulário, mas a lógica é a mesma (pontos → GPS → checagens → fotos → condições).</p>' + ul([
        '<strong>Ruído</strong> — externo, interno, ferroviário e aeronáutico.',
        '<strong>Vibração</strong> — detonação, cavernas/grutas, áreas habitadas.',
        '<strong>QAR Externo</strong>.',
        '<strong>QAR Interno</strong>.',
        '<strong>Opacidade</strong>.',
        '<strong>Outros</strong>.'
      ]) + '<div class="alerta alerta-amarelo">🚨 Sempre leia as informações da OS antes de iniciar o serviço. Em caso de dúvidas sobre a execução do serviço, busque informações com o seu supervisor e lembre-se que o procedimento e a norma de referência estão disponíveis no menu <strong>Biblioteca</strong>.</div>') +
      topico('📝 Rascunho: continuar ou reiniciar', ul([
        'Ao reabrir um serviço já começado, o app pergunta o que fazer:',
        '<strong>✏️ Continuar</strong> — retoma de onde parou.',
        '<strong>🔄 Reiniciar</strong> — começa do zero. O que já tinha sido preenchido NÃO é apagado: fica guardado (arquivado no SGP).',
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
        'Busque a <strong>OS</strong> (ou o nome da empresa/projeto) para a qual deseja pedir reembolso/pagamento. Preencha o nome do <strong>designado</strong>, ou seja, para quem é o reembolso. Se está pedindo para você mesmo, basta escolher o seu nome no designado.',
        'Escolha o <strong>tipo de reembolso</strong> (ver o tópico “Tipos de reembolso”) e preencha os campos.',
        'Anexe os <strong>comprovantes</strong> (📷 foto · 🖼️ galeria · 📎 PDF) e envie.'
      ])) +
      topico('🧳 Tipos de reembolso', ul([
        '🧳 <strong>Viagem:</strong> opção para solicitar a previsão de despesas de viagens destinadas à execução de serviços de monitoramento.',
        '➕ <strong>Complemento:</strong> opção para solicitar um valor complementar referente a despesas não previstas na solicitação inicial da viagem. Ou seja, caso algum valor não tenha sido considerado na previsão inicial, basta solicitar o complemento.<div class="alerta alerta-amarelo">🚨 <strong>Atenção:</strong> importante preencher o valor do hodômetro após chegar em casa (valor de 6 dígitos do painel do carro que mostra a quilometragem atual). O próprio e-CAMP calcula a quilometragem total percorrida e avalia se há ou não necessidade de reembolso a partir da quilometragem inicial considerada. <strong>A solicitação precisa ser tirada assim que você chega em casa para que não haja cobrança indevida de quilometragem. A foto é salva com carimbo de data, hora e coordenada geográfica.</strong></div>',
        '🔊 <strong>Eventos:</strong> opção para solicitar o pagamento do valor acordado para a realização de monitoramentos em eventos, como shows, partidas esportivas, feiras, entre outros.',
        '🚗 <strong>Veículos:</strong> opção para solicitar o reembolso ou pagamento de despesas relacionadas exclusivamente ao uso de veículos, como abastecimento, manutenção, pedágios e outros custos associados.'
      ])) +
      topico('📊 Acompanhar o status', ul([
        'Em <strong>“Minhas solicitações”</strong> cada pedido mostra o status:',
        '⏳ Aguardando aprovação da Logística → ✅ Aguardando pagamento → 💰 Pago.',
        'Toque numa solicitação para ver o <strong>extrato</strong> (valores, parcelas e comprovantes).',
        'Todas as suas solicitações ficam salvas com o detalhamento dos cálculos e as evidências anexadas, bem como os comprovantes de pagamento. Os registros ficam armazenados por mês e ano, podendo ser buscados pelo número da OS ou nome do cliente/projeto.'
      ])) +
      topico('➕ Saldo, adiantamento, ajuste e editar', ul([
        '<strong>Saldo pendente</strong> — se pediu menos de 100%, peça o que faltou. Basta clicar no botão <strong>“💠 Serviços com saldo pendente”</strong> e colocar a porcentagem que quer pedir.',
        '<strong>Adiantamento</strong> — caso a ENGEAR tenha pago algum valor adiantado, marque “Sim” em adiantamento e informe data e valor; o app desconta do total.',
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

      '<p class="ajuda-rodape">e-CAMP · ENGEAR Laboratório — dúvidas ou algo travado? Fale conosco.</p>'
    );
  }

  // Busca sem acento/caixa: filtra os tópicos pelo texto (título + corpo),
  // abre os que casam e esconde as seções que ficaram sem nenhum tópico.
  function semAcento(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function filtrar(termo) {
    var cont = document.getElementById('overlay-conteudo');
    if (!cont) return;
    var q = semAcento(termo).trim();
    var nodes = Array.prototype.slice.call(cont.children);
    var grupos = [], atual = null, temVis = false, algum = false;
    nodes.forEach(function (el) {
      if (el.classList.contains('ajuda-secao')) {
        if (atual) grupos.push({ sec: atual, vis: temVis });
        atual = el; temVis = false;
      } else if (el.classList.contains('ajuda-topico')) {
        var match = !q || semAcento(el.textContent).indexOf(q) !== -1;
        el.style.display = match ? '' : 'none';
        el.open = !!q && match; // abre nos resultados; recolhe quando a busca está vazia
        if (match) { temVis = true; algum = true; }
      }
    });
    if (atual) grupos.push({ sec: atual, vis: temVis });
    grupos.forEach(function (g) { g.sec.style.display = g.vis ? '' : 'none'; });
    var vazio = document.getElementById('ajuda-vazio');
    if (vazio) vazio.classList.toggle('oculto', algum || !q);
  }

  function abrir() {
    if (!(EC.app && EC.app.abrirOverlay)) return;
    EC.app.abrirOverlay('❓ Ajuda — como usar o e-CAMP', html());
    var input = document.getElementById('ajuda-busca');
    if (input) input.addEventListener('input', function () { filtrar(input.value); });
  }

  return { abrir: abrir };
})();
