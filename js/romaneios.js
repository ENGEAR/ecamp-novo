/**
 * romaneios.js — Checklists de pré-campo por tipo de monitoramento
 *
 * Guarda o conteúdo dos romaneios (o que conferir antes de sair do
 * laboratório) e desenha o checklist na tela, gerado dinamicamente conforme
 * o tipo escolhido. Nesta fase só o Ruído está preenchido; os demais tipos
 * entram na Fase 4 usando a mesma estrutura.
 *
 * Blocos marcados com `opcional: true` (ex.: itens de longa duração e de
 * monitoramento online no Ruído) NÃO entram na obrigatoriedade — o resto do
 * checklist precisa estar conferido para o fluxo liberar o "Próximo →".
 *
 * Interface (namespace global EC.romaneios):
 *   EC.romaneios.dados[tipo] → array de blocos { titulo, opcional?, grupos: [{ subtitulo?, itens: [string] }] }
 *   EC.romaneios.pendentesObrigatorios(tipo, marcados) → nº de itens
 *     obrigatórios ainda não conferidos (0 = pré-campo liberado; tipo sem
 *     romaneio também devolve 0, não trava)
 *   EC.romaneios.renderizar(container, tipo, marcados, aoMudar) → instância
 *     container : HTMLElement
 *     tipo      : 'ruido' | ... (se não houver romaneio, mostra aviso)
 *     marcados  : objeto { 'b0g0i0': true, ... } com o estado salvo dos checks
 *                 (a chave codifica bloco/grupo/item; o objeto é MUTADO em uso)
 *     aoMudar   : callback opcional chamado a cada check (recebe o resumo)
 *   instância.resumo() → { total, obrigatoriosTotal, obrigatoriosMarcados, obrigatoriosPendentes }
 */
window.EC = window.EC || {};

EC.romaneios = (function () {
  'use strict';

  const dados = {
    ruido: [
      {
        titulo: '1. Antes de sair do laboratório',
        grupos: [{
          itens: [
            'Ordem de Serviço (OS) avaliada',
            'Pontos amostrais previamente identificados por coordenadas',
            'Trajeto planejado, considerando chegada ao local com antecedência mínima de 1 hora',
            'Acesso ao local confirmado com o cliente',
            'EPIs disponíveis e em boas condições'
          ]
        }]
      },
      {
        titulo: '2. Equipamentos e insumos',
        grupos: [
          {
            subtitulo: 'Equipamentos de medição',
            itens: [
              'Etiqueta do Sonômetro com calibração válida',
              'Etiqueta do Calibrador acústico com calibração válida',
              'Etiqueta do Microfone com calibração válida',
              'Etiqueta do Termohigroanemômetro com calibração válida'
            ]
          },
          {
            subtitulo: 'Acessórios de campo',
            itens: [
              'Tripé para sonômetro',
              'Protetor de vento (windscreen)',
              'Trena métrica',
              'Maleta/mochila de transporte limpa e em bom estado'
            ]
          },
          {
            subtitulo: 'Alimentação e energia',
            itens: [
              'Carregador dos equipamentos',
              'Baterias reservas',
              'Power Bank carregado',
              'Celular carregado',
              'Carregador do celular'
            ]
          }
        ]
      },
      {
        titulo: '3. Itens adicionais para monitoramentos de longa duração',
        opcional: true,
        exigeLongaDuracao: true,
        grupos: [{
          itens: [
            'Cabo de extensão',
            'Estação meteorológica com calibração válida'
          ]
        }]
      },
      {
        titulo: '4. Itens adicionais para monitoramento online',
        opcional: true,
        exigeLongaDuracao: true,
        grupos: [{
          itens: [
            'Roteador 4G',
            'Verificação de sinal e funcionamento da internet móvel'
          ]
        }]
      },
      {
        titulo: '5. Verificação final',
        grupos: [{
          itens: [
            'Todos os equipamentos conferidos',
            'Baterias carregadas',
            'Materiais acondicionados adequadamente para transporte',
            'Equipe alinhada quanto ao escopo do serviço',
            'Horário de saída confirmado'
          ]
        }]
      }
    ]
    // sismo / qar / opacidade / qarint: Fase 4
  };

  // Um bloco é obrigatório se não é opcional OU se a OS é de longa duração e o
  // bloco está marcado como exigido nesse caso (itens de longa duração/online).
  function blocoObrigatorio(bloco, opcoes) {
    return !bloco.opcional || ((opcoes || {}).longaDuracao && bloco.exigeLongaDuracao);
  }

  // Chaves dos itens OBRIGATÓRIOS (considera o contexto de longa duração).
  function chavesObrigatorias(tipo, opcoes) {
    const blocos = dados[tipo];
    const chaves = [];
    if (!blocos) return chaves;
    blocos.forEach(function (bloco, b) {
      if (!blocoObrigatorio(bloco, opcoes)) return;
      bloco.grupos.forEach(function (grupo, g) {
        grupo.itens.forEach(function (item, i) {
          chaves.push('b' + b + 'g' + g + 'i' + i);
        });
      });
    });
    return chaves;
  }

  function pendentesObrigatorios(tipo, marcados, opcoes) {
    marcados = marcados || {};
    return chavesObrigatorias(tipo, opcoes).filter(function (chave) { return !marcados[chave]; }).length;
  }

  function renderizar(container, tipo, marcados, aoMudar, opcoes) {
    const blocos = dados[tipo];
    if (!blocos) {
      container.innerHTML = '<p class="texto-apoio">O checklist de pré-campo deste tipo entra na Fase 4.</p>';
      return { resumo: function () { return { total: 0, obrigatoriosTotal: 0, obrigatoriosMarcados: 0, obrigatoriosPendentes: 0 }; } };
    }

    let total = 0;
    let html = '';
    blocos.forEach(function (bloco, b) {
      // Bloco obrigatório não recebe tag (em longa duração, todos são
      // obrigatórios → todos sem tag). Só blocos opcionais mostram "(opcional)".
      const selo = blocoObrigatorio(bloco, opcoes) ? '' : ' <span class="romaneio-opcional">(opcional)</span>';
      html += '<h2 class="romaneio-titulo">' + bloco.titulo + selo + '</h2>';
      bloco.grupos.forEach(function (grupo, g) {
        if (grupo.subtitulo) html += '<p class="romaneio-subtitulo">' + grupo.subtitulo + '</p>';
        grupo.itens.forEach(function (item, i) {
          const chave = 'b' + b + 'g' + g + 'i' + i;
          total++;
          html += '<label class="linha-check romaneio-item"><input type="checkbox" data-chave="' + chave + '"' +
            (marcados[chave] ? ' checked' : '') + '><span>' + item + '</span></label>';
        });
      });
    });
    html += '<div class="romaneio-resumo"></div>';
    container.innerHTML = html;

    const caixaResumo = container.querySelector('.romaneio-resumo');
    const obrigatorias = chavesObrigatorias(tipo, opcoes);

    function resumo() {
      let obrigMarcados = 0;
      obrigatorias.forEach(function (chave) { if (marcados[chave]) obrigMarcados++; });
      return {
        total: total,
        obrigatoriosTotal: obrigatorias.length,
        obrigatoriosMarcados: obrigMarcados,
        obrigatoriosPendentes: obrigatorias.length - obrigMarcados
      };
    }

    function atualizarResumo() {
      const r = resumo();
      const completo = r.obrigatoriosPendentes === 0;
      caixaResumo.textContent = completo
        ? '✓ Itens obrigatórios conferidos (' + r.obrigatoriosTotal + '/' + r.obrigatoriosTotal + ')'
        : r.obrigatoriosMarcados + ' de ' + r.obrigatoriosTotal + ' itens obrigatórios conferidos';
      caixaResumo.classList.toggle('romaneio-completo', completo);
    }

    container.querySelectorAll('input[data-chave]').forEach(function (caixa) {
      caixa.addEventListener('change', function () {
        marcados[caixa.dataset.chave] = caixa.checked;
        atualizarResumo();
        if (typeof aoMudar === 'function') aoMudar(resumo());
      });
    });

    atualizarResumo();
    return { resumo: resumo };
  }

  return { dados: dados, renderizar: renderizar, pendentesObrigatorios: pendentesObrigatorios };
})();
