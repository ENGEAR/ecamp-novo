/**
 * romaneios.js — Checklists de pré-campo por tipo de monitoramento
 *
 * Guarda o conteúdo dos romaneios (o que conferir antes de sair do
 * laboratório) e desenha o checklist na tela, gerado dinamicamente conforme
 * o tipo escolhido. Nesta fase só o Ruído está preenchido; os demais tipos
 * entram na Fase 4 usando a mesma estrutura.
 *
 * Interface (namespace global EC.romaneios):
 *   EC.romaneios.dados[tipo] → array de blocos { titulo, grupos: [{ subtitulo?, itens: [string] }] }
 *   EC.romaneios.renderizar(container, tipo, marcados, aoMudar) → instância
 *     container : HTMLElement
 *     tipo      : 'ruido' | ... (se não houver romaneio, mostra aviso)
 *     marcados  : objeto { 'b0g0i0': true, ... } com o estado salvo dos checks
 *                 (a chave codifica bloco/grupo/item; o objeto é MUTADO em uso)
 *     aoMudar   : callback opcional chamado a cada check (recebe o resumo)
 *   instância.resumo() → { total, marcados }
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
              'Sonômetro com calibração válida',
              'Calibrador acústico com calibração válida',
              'Microfone com calibração válida',
              'Termohigroanemômetro com calibração válida'
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
        grupos: [{
          itens: [
            'Cabo de extensão',
            'Estação meteorológica com calibração válida'
          ]
        }]
      },
      {
        titulo: '4. Itens adicionais para monitoramento online',
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
            'Certificados de calibração disponíveis',
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

  function renderizar(container, tipo, marcados, aoMudar) {
    const blocos = dados[tipo];
    if (!blocos) {
      container.innerHTML = '<p class="texto-apoio">O checklist de pré-campo deste tipo entra na Fase 4.</p>';
      return { resumo: function () { return { total: 0, marcados: 0 }; } };
    }

    let total = 0;
    let html = '';
    blocos.forEach(function (bloco, b) {
      html += '<h2 class="romaneio-titulo">' + bloco.titulo + '</h2>';
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

    function resumo() {
      let qtde = 0;
      Object.keys(marcados).forEach(function (chave) { if (marcados[chave]) qtde++; });
      return { total: total, marcados: qtde };
    }

    function atualizarResumo() {
      const r = resumo();
      caixaResumo.textContent = r.marcados + ' de ' + r.total + ' itens conferidos';
      caixaResumo.classList.toggle('romaneio-completo', r.marcados === r.total);
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

  return { dados: dados, renderizar: renderizar };
})();
