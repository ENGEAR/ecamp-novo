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
    ],
    sismo: [
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
              'Sismógrafo com calibração válida',
              'Geofone com calibração válida',
              'Microfone com calibração válida',
              'Termohigroanemômetro'
            ]
          },
          {
            subtitulo: 'Cabos e acessórios',
            itens: [
              'Cabo de conexão entre sismógrafo e geofone',
              'Tripé para microfone',
              'Protetor de vento para microfone'
            ]
          },
          {
            subtitulo: 'Alimentação e energia',
            itens: [
              'Carregadores dos equipamentos',
              'Baterias reservas',
              'Power Bank carregado',
              'Celular carregado',
              'Carregador do celular'
            ]
          },
          {
            subtitulo: 'Informática',
            itens: [
              'Notebook com software SISTEX instalado e funcional (confirmar necessidade com o coordenador)'
            ]
          },
          {
            subtitulo: 'Transporte e apoio',
            itens: [
              'Maleta de transporte (obrigatória)',
              'Trena métrica'
            ]
          }
        ]
      },
      {
        titulo: '3. Insumos para fixação do geofone',
        grupos: [
          {
            subtitulo: 'Instalação em solo',
            itens: ['Cravos para fixação do geofone']
          },
          {
            subtitulo: 'Instalação em superfícies rígidas',
            itens: [
              'Gesso de secagem rápida',
              'Água potável para preparo do gesso',
              'Vasilhame para preparo da massa',
              'Fita adesiva para proteção dos furos do geofone',
              'Espátula para remoção do gesso após a medição'
            ]
          }
        ]
      },
      {
        titulo: '4. Verificação final',
        grupos: [{
          itens: [
            'Equipamentos conferidos e funcionando',
            'Certificados de calibração disponíveis',
            'Baterias carregadas',
            'Materiais acondicionados adequadamente para transporte',
            'Software SISTEX testado (quando aplicável)',
            'Equipe alinhada quanto ao escopo do serviço',
            'Horário de saída confirmado'
          ]
        }]
      }
    ],
    qar: [
      {
        titulo: '1. Antes de sair do laboratório',
        grupos: [{
          itens: [
            'Ordem de Serviço (OS) avaliada',
            'Pontos amostrais previamente identificados por coordenadas',
            'Trajeto planejado, considerando chegada ao local com antecedência mínima de 1 hora',
            'Acesso ao local confirmado com o cliente',
            'Local de instalação confirmado e com disponibilidade de energia elétrica (tomada)',
            'EPIs disponíveis e em boas condições'
          ]
        }]
      },
      {
        titulo: '2. Equipamentos e insumos',
        grupos: [
          {
            subtitulo: 'Amostradores',
            aoMenosUm: true,
            itens: ['Amostrador AGV PTS (limpo)', 'Amostrador AGV MP10 (limpo)', 'Amostrador AGV MP2,5 (limpo)']
          },
          {
            subtitulo: 'Equipamentos de calibração',
            itens: ['Maleta de calibração (PTV, manômetro de 400 mm, placas 18 / 13 / 10 / 9 / 8)']
          },
          {
            subtitulo: 'Ferramentas e manutenção',
            itens: [
              'Maleta de ferramentas (multímetro, alicate, chave de fenda, fita isolante)',
              'Motor reserva',
              'Escova para limpeza do MP2,5',
              'Pano de limpeza',
              'Seringa',
              'Líquido para completar manômetro'
            ]
          },
          {
            subtitulo: 'Instrumentos meteorológicos',
            itens: ['Termohigrômetro', 'Barômetro de campo']
          },
          {
            subtitulo: 'Materiais de amostragem',
            itens: ['Filtros tarados com número de identificação', 'Filtros verificados (rasgos, descoloração, contaminação)']
          },
          {
            subtitulo: 'Estrutura de instalação',
            itens: ['Cavalete', 'Trena', 'Tomada reserva', 'Transformador', 'Cabo de extensão / fonte de alimentação (medidas verificadas)', 'Silicone']
          },
          {
            subtitulo: 'Materiais de apoio',
            itens: ['Luvas', 'Sacos plásticos', 'Pilhas']
          },
          {
            subtitulo: 'Informática e comunicação',
            itens: ['Notebook carregado', 'Carregador do notebook', 'Celular carregado', 'Carregador do celular', 'Power Bank carregado']
          }
        ]
      },
      {
        titulo: '3. Verificação final',
        grupos: [{
          itens: [
            'Equipamentos limpos e conferidos',
            'Certificados de calibração disponíveis',
            'Filtros conferidos e identificados',
            'Ferramentas e insumos completos',
            'Baterias e equipamentos eletrônicos carregados',
            'Materiais acondicionados adequadamente para transporte',
            'Equipe alinhada quanto ao escopo do serviço',
            'Horário de saída confirmado'
          ]
        }]
      }
    ],
    opacidade_ringelmann: [
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
          { subtitulo: 'Instrumentos de avaliação', itens: ['Escala de Ringelmann reduzida íntegra e legível', 'Envelope protetor da escala', 'Placa de acrílico transparente com fundo branco'] },
          { subtitulo: 'Instrumentos de apoio', itens: ['Cronômetro', 'Termohigroanemômetro', 'Trena métrica'] },
          { subtitulo: 'Registro de dados', itens: ['Prancheta ou suporte para anotação', 'Formulários de campo impressos (quando aplicável)', 'Canetas ou lápis para registro'] },
          { subtitulo: 'Comunicação e energia', itens: ['Celular carregado', 'Carregador do celular'] }
        ]
      },
      {
        titulo: '3. Verificações antes da avaliação',
        grupos: [{
          itens: [
            'Escala de Ringelmann limpa, íntegra e sem desbotamento',
            'Placa de acrílico limpa e sem riscos que prejudiquem a visualização',
            'Cronômetro funcionando adequadamente',
            'Termohigroanemômetro funcionando adequadamente',
            'Condições de visibilidade adequadas para a avaliação',
            'Materiais de anotação disponíveis'
          ]
        }]
      },
      {
        titulo: '4. Verificação final',
        grupos: [{
          itens: [
            'Equipamentos conferidos e acondicionados para transporte',
            'Materiais de registro disponíveis',
            'Equipe alinhada quanto ao escopo do serviço',
            'Horário de saída confirmado',
            'Condições de acesso ao ponto de observação verificadas'
          ]
        }]
      }
    ],
    opacidade_opacimetro: [
      {
        titulo: '1. Antes de sair do laboratório',
        grupos: [{
          itens: [
            'Ordem de Serviço (OS) avaliada',
            'Pontos amostrais previamente identificados por coordenadas',
            'Trajeto planejado, considerando chegada ao local com antecedência mínima de 1 hora',
            'Acesso ao local confirmado com o cliente',
            'Local de instalação confirmado e com disponibilidade de energia elétrica (tomada)',
            'EPIs disponíveis e em boas condições'
          ]
        }]
      },
      {
        titulo: '2. Equipamentos e insumos',
        grupos: [
          { subtitulo: 'Equipamento principal', itens: ['Opacímetro', 'Inspeção visual realizada (sem avarias aparentes)'] },
          { subtitulo: 'Componentes do sistema', itens: ['Sonda de amostragem', 'Cabo de conexão da sonda', 'Empunhadura para manuseio da sonda', 'Tripé articulado', 'Barra extensora', 'Redutor de diâmetro da sonda (para escapamentos ≤ 50 mm)'] },
          { subtitulo: 'Verificação e controle metrológico', itens: ['Filtros-padrão de densidade neutra (2 unidades)', 'Certificados de calibração disponíveis (quando aplicável)'] },
          { subtitulo: 'Alimentação e energia', itens: ['Carregador de bateria do opacímetro', 'Celular carregado', 'Carregador do celular'] },
          { subtitulo: 'Impressão e registro', itens: ['Papel para impressora térmica', 'Rolos sobressalentes disponíveis'] },
          { subtitulo: 'Limpeza e manutenção', itens: ['Ferramentas de limpeza (chave, cotonetes)', 'Panos para limpeza', 'Cotonete', 'Álcool isopropílico para limpeza das lentes', 'Algodão', 'Detergente suave para limpeza das lentes'] },
          { subtitulo: 'Segurança operacional', itens: ['Calços para travamento das rodas do veículo', 'Luvas térmicas'] }
        ]
      },
      {
        titulo: '3. Verificações antes da medição',
        grupos: [{
          itens: [
            'Funcionamento do opacímetro verificado',
            'Integridade da sonda e dos cabos verificada',
            'Filtros-padrão disponíveis e em bom estado',
            'Impressora funcionando e com papel instalado',
            'Bateria carregada',
            'Materiais de limpeza disponíveis',
            'Calços e EPIs disponíveis para uso'
          ]
        }]
      },
      {
        titulo: '4. Verificação final',
        grupos: [{
          itens: [
            'Equipamentos conferidos e acondicionados adequadamente para transporte',
            'Certificados e documentação disponíveis',
            'Impressora abastecida com papel',
            'Ferramentas e insumos completos',
            'Equipe alinhada quanto ao escopo do serviço',
            'Horário de saída confirmado',
            'Condições de acesso e operação confirmadas com o cliente'
          ]
        }]
      }
    ]
    // qarint: Fase 4
  };

  // Um bloco é obrigatório se não é opcional OU se a OS é de longa duração e o
  // bloco está marcado como exigido nesse caso (itens de longa duração/online).
  function blocoObrigatorio(bloco, opcoes) {
    return !bloco.opcional || ((opcoes || {}).longaDuracao && bloco.exigeLongaDuracao);
  }

  // Obrigações do romaneio (considera o contexto de longa duração). Um grupo
  // normal gera UMA obrigação por item (todos precisam ser marcados); um grupo
  // com `aoMenosUm: true` gera UMA obrigação satisfeita por qualquer item dele.
  function obrigacoes(tipo, opcoes) {
    const blocos = dados[tipo];
    const lista = [];
    if (!blocos) return lista;
    blocos.forEach(function (bloco, b) {
      if (!blocoObrigatorio(bloco, opcoes)) return;
      bloco.grupos.forEach(function (grupo, g) {
        const chaves = grupo.itens.map(function (item, i) { return 'b' + b + 'g' + g + 'i' + i; });
        if (grupo.aoMenosUm) lista.push({ chaves: chaves });
        else chaves.forEach(function (k) { lista.push({ chaves: [k] }); });
      });
    });
    return lista;
  }

  // Uma obrigação está satisfeita se QUALQUER uma de suas chaves está marcada
  // (para item único, equivale a "aquele item marcado").
  function satisfeita(obrig, marcados) {
    return obrig.chaves.some(function (k) { return marcados[k]; });
  }

  function pendentesObrigatorios(tipo, marcados, opcoes) {
    marcados = marcados || {};
    return obrigacoes(tipo, opcoes).filter(function (o) { return !satisfeita(o, marcados); }).length;
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
        if (grupo.subtitulo) html += '<p class="romaneio-subtitulo">' + grupo.subtitulo + (grupo.aoMenosUm ? ' <span class="romaneio-opcional">(marque ao menos um)</span>' : '') + '</p>';
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
    const obrigs = obrigacoes(tipo, opcoes);

    function resumo() {
      let obrigMarcados = 0;
      obrigs.forEach(function (o) { if (satisfeita(o, marcados)) obrigMarcados++; });
      return {
        total: total,
        obrigatoriosTotal: obrigs.length,
        obrigatoriosMarcados: obrigMarcados,
        obrigatoriosPendentes: obrigs.length - obrigMarcados
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
