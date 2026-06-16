/**
 * dados-os-mock.js — Lista de OS de EXEMPLO (mock) para desenvolvimento
 *
 * A lista real virá do SGE (seção 4.4 da especificação); a ponte de leitura
 * ainda será definida. Enquanto isso, o fluxo de serviços usa esta lista fixa.
 *
 * Uma OS pode conter VÁRIOS serviços (escopos), eventualmente em campanhas
 * diferentes (ex.: Ruído + Vibração na mesma campanha; QAR numa campanha
 * posterior). Cada serviço é monitorado de forma independente e vira um
 * registro/PDF próprio.
 *
 * Interface (namespace global EC.osMock):
 *   EC.osMock → array de OS, cada uma com:
 *     numero      : nº da OS               (ex.: '2026-0158')
 *     cliente     : nome do cliente        (nível OS)
 *     endereco    : endereço do local      (nível OS)
 *     resumo      : resumo do serviço      (nível OS)
 *     observacao  : observações da OS      (nível OS)
 *     servicos    : array de serviços, cada um com:
 *       campanha    : rótulo da campanha   (ex.: 'Campanha 1' / 'Campanha única')
 *       escopo      : escopo/norma         (define o tipo e o subtipo do monitoramento)
 *       qtdePontos  : quantidade de pontos prevista (o técnico pode editar c/ justificativa)
 *       dias        : nº de dias de medição previstos
 *       periodo     : período da medição (ex.: '24 h contínuas', '15 min')
 *       metodo      : modalidade da medição (ex.: 'Longa duração', 'Pontual')
 *       observacao  : observações do serviço
 *
 * Quando a ponte com o SGE existir, este arquivo será substituído pela
 * leitura real — mantendo os mesmos campos.
 */
window.EC = window.EC || {};

EC.osMock = [
  {
    numero: '2026-0158',
    cliente: 'Mineração Alfa Ltda',
    endereco: 'Rodovia BR-040, km 12 — Sete Lagoas/MG',
    resumo: 'Monitoramento de ruído ambiental na divisa com área residencial',
    observacao: 'Acesso pela portaria principal; avisar a segurança na chegada.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-alfa-setelagoas',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 3,
        metodo: 'Ambiente externo',
        periodo: '1 dia de medição (período diurno e noturno)',
        observacao: 'Medir na divisa com as residências.'
      }
    ]
  },
  {
    numero: '2026-0163',
    cliente: 'Construtora Beta S.A.',
    endereco: 'Av. dos Andradas, 4500 — Belo Horizonte/MG',
    resumo: 'Ruído e vibração do desmonte de rocha — obra de fundação',
    observacao: 'Confirmar horário do desmonte com o responsável da obra.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-beta-bh',
    servicos: [
      {
        campanha: 'Campanha 1',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 2,
        metodo: 'Ambiente externo',
        periodo: 'Campanha 1 — 1 dia',
        observacao: 'Pontos na divisa com as residências vizinhas.'
      },
      {
        campanha: 'Campanha 1',
        escopo: 'Sismografia – NBR 9653',
        qtdePontos: 2,
        metodo: 'ABNT NBR 9653:2018 · Procedimento interno: POP 002',
        periodo: 'Campanha 1 — 1 dia (dia do desmonte)',
        observacao: 'Sincronizar a medição com o horário do fogo.'
      }
    ]
  },
  {
    numero: '2026-0171',
    cliente: 'Indústria Gama Alimentos',
    endereco: 'Distrito Industrial, Quadra 8 — Contagem/MG',
    resumo: 'Qualidade do ar externo — particulados no entorno da caldeira',
    observacao: 'Local de instalação com tomada confirmada; levar cabo de extensão.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-gama-contagem',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Qualidade do Ar Externo – PTS e PM10',
        qtdePontos: 4,
        metodo: 'ABNT NBR 9547 / NBR 13412 · Procedimento interno: POP 010',
        periodo: '4 dias de amostragem (24 h por ponto)',
        observacao: 'Instalar a sotavento da fonte.'
      }
    ]
  },
  {
    numero: '2026-0185',
    cliente: 'Hospital Delta',
    endereco: 'Rua das Acácias, 120 — Nova Lima/MG',
    resumo: 'Qualidade do ar interno (MQAI) — bloco cirúrgico',
    observacao: 'Coleta microbiológica; retorno das amostras ao laboratório no mesmo dia.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-delta-novalima',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Qualidade do Ar Interno – MQAI (RE 09/2003 ANVISA)',
        qtdePontos: 5,
        metodo: 'RE ANVISA 09/2003 · Procedimento interno: POP 015',
        periodo: '1 dia (ambientes climatizados)',
        observacao: 'Confirmar ambientes climatizados com a engenharia clínica.'
      }
    ]
  },
  {
    numero: '2026-0192',
    cliente: 'Pedreira São João Ltda',
    endereco: 'Rodovia MG-050, km 78 — Juatuba/MG',
    resumo: 'Monitoramento ambiental do desmonte e do entorno (várias campanhas)',
    observacao: 'Campanhas em meses diferentes; confirmar a agenda com o cliente antes de cada ida.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-pedreira-juatuba',
    servicos: [
      {
        campanha: 'Campanha 1',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 3,
        metodo: 'Ambiente externo',
        periodo: 'Campanha 1 — 1 dia',
        observacao: 'Pontos na divisa norte e leste.'
      },
      {
        campanha: 'Campanha 1',
        escopo: 'Sismografia – NBR 9653',
        qtdePontos: 2,
        metodo: 'ABNT NBR 9653:2018 · Procedimento interno: POP 002',
        periodo: 'Campanha 1 — 1 dia (dia do desmonte)',
        observacao: 'Sincronizar com o fogo; geofones no solo consolidado.'
      },
      {
        campanha: 'Campanha 2',
        escopo: 'Qualidade do Ar Externo – Poeira Sedimentável',
        qtdePontos: 4,
        metodo: 'ABNT NBR 15402 · Procedimento interno: POP 012',
        periodo: 'Campanha 2 — 30 dias de exposição',
        observacao: 'Instalar os frascos; coletar após 30 dias.'
      }
    ]
  },
  {
    numero: '2026-0205',
    cliente: 'Transportadora Horizonte',
    endereco: 'Pátio logístico, Av. das Indústrias, 2200 — Betim/MG',
    resumo: 'Opacidade da frota de veículos a diesel',
    observacao: 'Veículos disponibilizados no pátio; conferir aquecimento do motor antes da medição.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-horizonte-betim',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Fuligem – Opacímetro',
        qtdePontos: 10,
        metodo: 'CONAMA 418 / ABNT NBR 13037 · Procedimento interno: POP 020',
        periodo: '1 dia',
        observacao: '10 veículos; 3 leituras válidas por veículo.'
      }
    ]
  },

  // ===== OS de validação do RUÍDO (uma de cada subtipo) =====
  {
    numero: '2026-0210',
    cliente: 'Colégio Monte Verde',
    endereco: 'Rua das Hortênsias, 75 — Belo Horizonte/MG',
    resumo: 'Ruído interno em salas de aula (NBR 10152)',
    observacao: 'Medir preferencialmente sem alunos; agendar fora do horário de aula.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-monteverde-bh',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Interno – NBR 10152',
        qtdePontos: 3,
        dias: 1,
        periodo: 'Diurno',
        metodo: '',
        observacao: 'Avaliar 3 salas; esquadrias fechadas.'
      }
    ]
  },
  {
    numero: '2026-0211',
    cliente: 'Ferrovia Central de Carga',
    endereco: 'Travessia urbana, km 230 — Sabará/MG',
    resumo: 'Ruído de transporte ferroviário (NBR 16425-4)',
    observacao: 'Confirmar a janela de passagem das composições com o operador da via.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-ferrovia-sabara',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Transportes – Ferroviário (NBR 16425-4)',
        qtdePontos: 2,
        dias: 1,
        periodo: 'Diurno',
        metodo: 'Passagem de composição ferroviária',
        observacao: 'Pontos em residências próximas ao cruzamento.'
      }
    ]
  },
  {
    numero: '2026-0212',
    cliente: 'Aeroporto Regional Serra Azul',
    endereco: 'Estrada do Aeroporto, s/n — Confins/MG',
    resumo: 'Ruído de transporte aéreo (NBR 16425-2)',
    observacao: 'Acesso à área operacional mediante credenciamento prévio.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-aeroporto-confins',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Transportes – Aéreo (NBR 16425-2)',
        qtdePontos: 2,
        dias: 1,
        periodo: 'Diurno',
        metodo: 'Receptores críticos',
        observacao: 'Pontos em receptores críticos (residências sob a rota).'
      }
    ]
  },
  {
    numero: '2026-0213',
    cliente: 'Condomínio Parque das Águas',
    endereco: 'Alameda dos Ipês, 1000 — Nova Lima/MG',
    resumo: 'Ruído ambiental de longa duração — 24 h (NBR 10151)',
    observacao: 'Instalação para longa duração; garantir autonomia de energia e microfone a ≥ 4 m.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-parqueaguas-novalima',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 1,
        dias: 1,
        periodo: '24 h contínuas',
        metodo: 'Longa duração',
        observacao: 'Microfone a ≥ 4 m do solo; itens de longa duração do romaneio (estação meteorológica, power bank/roteador).'
      }
    ]
  },
  {
    numero: '2026-0220',
    cliente: 'Escritório Central Sul',
    endereco: 'Av. Afonso Pena, 1500 — Belo Horizonte/MG',
    resumo: 'Ruído ambiental medido no interior do imóvel afetado (NBR 10151 – ambiente interno)',
    observacao: 'Medição interna conforme NBR 10151; ambiente cedido pelo reclamante.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-escritorio-bh',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 2,
        dias: 1,
        periodo: 'Diurno e noturno',
        metodo: 'Ambiente interno',
        observacao: 'Avaliar os ambientes internos do imóvel afetado.'
      }
    ]
  }
];
