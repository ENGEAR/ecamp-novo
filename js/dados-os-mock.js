/**
 * dados-os-mock.js — Lista de OS de EXEMPLO (mock) para desenvolvimento
 *
 * Espelha o modelo oficial de OS da ENGEAR (PDF "OS TESTE"). A lista real virá
 * do SGE; até lá o fluxo usa esta lista fixa.
 *
 * Interface (namespace global EC.osMock):
 *   EC.osMock → array de OS, cada uma com:
 *     numero        : nº da OS
 *     emitidoPor    : quem emitiu a OS
 *     dataEmissao   : data de emissão da OS (AAAA-MM-DD)
 *     cliente       : razão social do contratante
 *     cnpjCpf       : CNPJ/CPF do contratante
 *     endereco      : endereço do local do serviço (mesmo do contratante)
 *     contato       : contato do cliente
 *     resumo        : descrição do serviço (campo "Serviço" da OS)
 *     frequencia    : frequência do serviço
 *     rota          : rota
 *     observacao    : observações gerais da OS
 *     linkMaps      : link do Google Maps do local
 *     servicos      : array de serviços (escopos), cada um com:
 *       campanha, escopo, qtdePontos (editável), dias, periodo, metodo, observacao
 *
 * Derivados no código (não ficam aqui): código da OS, Município/UF (do endereço)
 * e nº de campanhas (contagem das campanhas distintas em servicos).
 */
window.EC = window.EC || {};

EC.osMock = [
  {
    numero: '2026-0158',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-05-28',
    cliente: 'Mineração Alfa Ltda',
    cnpjCpf: '12.345.678/0001-90',
    endereco: 'Rodovia BR-040, km 12 — Sete Lagoas/MG',
    contato: 'Eng. Marcos (31) 99999-1111',
    resumo: 'Monitoramento de ruído ambiental na divisa com área residencial',
    frequencia: 'Pontual',
    rota: 'Sete Lagoas/MG',
    observacao: 'Acesso pela portaria principal; avisar a segurança na chegada.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-alfa-setelagoas',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 3,
        dias: 1,
        metodo: 'Ambiente externo',
        periodo: 'Diurno e noturno',
        observacao: 'Medir na divisa com as residências.'
      }
    ]
  },
  {
    numero: '2026-0163',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-05-30',
    cliente: 'Construtora Beta S.A.',
    cnpjCpf: '98.765.432/0001-10',
    endereco: 'Av. dos Andradas, 4500 — Belo Horizonte/MG',
    contato: 'Sra. Helena (31) 98888-2222',
    resumo: 'Ruído e vibração do desmonte de rocha — obra de fundação',
    frequencia: 'Pontual',
    rota: 'Belo Horizonte/MG',
    observacao: 'Confirmar horário do desmonte com o responsável da obra.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-beta-bh',
    servicos: [
      {
        campanha: 'Campanha 1',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 2,
        dias: 1,
        metodo: 'Ambiente externo',
        periodo: 'Diurno',
        observacao: 'Pontos na divisa com as residências vizinhas.'
      },
      {
        campanha: 'Campanha 1',
        escopo: 'Sismografia – NBR 9653',
        qtdePontos: 2,
        dias: 1,
        metodo: 'Usual',
        periodo: 'Dia do desmonte',
        observacao: 'Sincronizar a medição com o horário do fogo.'
      }
    ]
  },
  {
    numero: '2026-0171',
    emitidoPor: 'Comercial ENGEAR',
    dataEmissao: '2026-06-02',
    cliente: 'Indústria Gama Alimentos',
    cnpjCpf: '11.222.333/0001-44',
    endereco: 'Distrito Industrial, Quadra 8 — Contagem/MG',
    contato: 'Sr. Paulo (31) 97777-3333',
    resumo: 'Qualidade do ar externo — particulados no entorno da caldeira',
    frequencia: 'Semestral',
    rota: 'Contagem/MG',
    observacao: 'Local de instalação com tomada confirmada; levar cabo de extensão.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-gama-contagem',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Qualidade do Ar Externo – PTS e PM10',
        qtdePontos: 4,
        dias: 4,
        metodo: '',
        periodo: '24 h por ponto',
        observacao: 'Instalar a sotavento da fonte.'
      }
    ]
  },
  {
    numero: '2026-0185',
    emitidoPor: 'Comercial ENGEAR',
    dataEmissao: '2026-06-05',
    cliente: 'Hospital Delta',
    cnpjCpf: '44.555.666/0001-77',
    endereco: 'Rua das Acácias, 120 — Nova Lima/MG',
    contato: 'Eng. Clínica (31) 96666-4444',
    resumo: 'Qualidade do ar interno (MQAI) — bloco cirúrgico',
    frequencia: 'Anual',
    rota: 'Nova Lima/MG',
    observacao: 'Coleta microbiológica; retorno das amostras ao laboratório no mesmo dia.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-delta-novalima',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Qualidade do Ar Interno – MQAI (RE 09/2003 ANVISA)',
        qtdePontos: 5,
        dias: 1,
        metodo: '',
        periodo: 'Ambientes climatizados',
        observacao: 'Confirmar ambientes climatizados com a engenharia clínica.'
      }
    ]
  },
  {
    numero: '2026-0192',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-08',
    cliente: 'Pedreira São João Ltda',
    cnpjCpf: '22.333.444/0001-55',
    endereco: 'Rodovia MG-050, km 78 — Juatuba/MG',
    contato: 'Sr. Antônio (31) 95555-5555',
    resumo: 'Monitoramento ambiental do desmonte e do entorno (várias campanhas)',
    frequencia: 'Conforme desmonte',
    rota: 'Juatuba/MG',
    observacao: 'Campanhas em meses diferentes; confirmar a agenda com o cliente antes de cada ida.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-pedreira-juatuba',
    servicos: [
      {
        campanha: 'Campanha 1',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 3,
        dias: 1,
        metodo: 'Ambiente externo',
        periodo: 'Diurno',
        observacao: 'Pontos na divisa norte e leste.'
      },
      {
        campanha: 'Campanha 1',
        escopo: 'Sismografia – NBR 9653',
        qtdePontos: 2,
        dias: 1,
        metodo: 'Usual',
        periodo: 'Dia do desmonte',
        observacao: 'Sincronizar com o fogo; geofones no solo consolidado.'
      },
      {
        campanha: 'Campanha 2',
        escopo: 'Qualidade do Ar Externo – Poeira Sedimentável',
        qtdePontos: 4,
        dias: 30,
        metodo: '',
        periodo: '30 dias de exposição',
        observacao: 'Instalar os frascos; coletar após 30 dias.'
      }
    ]
  },
  {
    numero: '2026-0205',
    emitidoPor: 'Comercial ENGEAR',
    dataEmissao: '2026-06-10',
    cliente: 'Transportadora Horizonte',
    cnpjCpf: '33.444.555/0001-66',
    endereco: 'Pátio logístico, Av. das Indústrias, 2200 — Betim/MG',
    contato: 'Sr. Júlio (31) 94444-6666',
    resumo: 'Opacidade da frota de veículos a diesel',
    frequencia: 'Anual',
    rota: 'Betim/MG',
    observacao: 'Veículos disponibilizados no pátio; conferir aquecimento do motor antes da medição.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-horizonte-betim',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Fuligem – Opacímetro',
        qtdePontos: 10,
        dias: 1,
        metodo: '',
        periodo: '1 dia',
        observacao: '10 veículos; 3 leituras válidas por veículo.'
      }
    ]
  },

  // ===== OS de validação do RUÍDO (uma de cada subtipo/método) =====
  {
    numero: '2026-0210',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-12',
    cliente: 'Colégio Monte Verde',
    cnpjCpf: '55.666.777/0001-88',
    endereco: 'Rua das Hortênsias, 75 — Belo Horizonte/MG',
    contato: 'Diretoria (31) 93333-7777',
    resumo: 'Ruído interno em salas de aula (NBR 10152)',
    frequencia: 'Pontual',
    rota: 'Belo Horizonte/MG',
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
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-12',
    cliente: 'Ferrovia Central de Carga',
    cnpjCpf: '66.777.888/0001-99',
    endereco: 'Travessia urbana, km 230 — Sabará/MG',
    contato: 'Operação da via (31) 92222-8888',
    resumo: 'Ruído de transporte ferroviário (NBR 16425-4)',
    frequencia: 'Pontual',
    rota: 'Sabará/MG',
    observacao: 'Confirmar a janela de passagem das composições com o operador da via.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-ferrovia-sabara',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Transportes – Ferroviário (NBR 16425-4)',
        qtdePontos: 2,
        dias: 1,
        periodo: 'Diurno',
        metodo: 'Passagem de Composição Férrea',
        observacao: 'Pontos em residências próximas ao cruzamento.'
      }
    ]
  },
  {
    numero: '2026-0212',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-12',
    cliente: 'Aeroporto Regional Serra Azul',
    cnpjCpf: '77.888.999/0001-00',
    endereco: 'Estrada do Aeroporto, s/n — Confins/MG',
    contato: 'Coord. Aeroportuário (31) 91111-9999',
    resumo: 'Ruído de transporte aéreo (NBR 16425-2)',
    frequencia: 'Pontual',
    rota: 'Confins/MG',
    observacao: 'Acesso à área operacional mediante credenciamento prévio.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-aeroporto-confins',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Transportes – Aéreo (NBR 16425-2)',
        qtdePontos: 2,
        dias: 1,
        periodo: 'Diurno',
        metodo: 'Monitoramento de Receptores Potencialmente Críticos',
        observacao: 'Pontos em receptores críticos (residências sob a rota).'
      }
    ]
  },
  {
    numero: '2026-0213',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-13',
    cliente: 'Condomínio Parque das Águas',
    cnpjCpf: '88.999.000/0001-11',
    endereco: 'Alameda dos Ipês, 1000 — Nova Lima/MG',
    contato: 'Síndico (31) 90000-1010',
    resumo: 'Ruído ambiental de longa duração — 24 h (NBR 10151)',
    frequencia: 'Pontual',
    rota: 'Nova Lima/MG',
    observacao: 'Instalação para longa duração; garantir autonomia de energia e microfone a ≥ 4 m.',
    linkMaps: 'https://maps.app.goo.gl/exemplo-parqueaguas-novalima',
    servicos: [
      {
        campanha: 'Campanha única',
        escopo: 'Ruído Ambiental – NBR 10151',
        qtdePontos: 1,
        dias: 1,
        periodo: '24h',
        metodo: 'Longa duração',
        observacao: 'Microfone a ≥ 4 m do solo; itens de longa duração do romaneio (estação meteorológica, power bank/roteador).'
      }
    ]
  },
  {
    numero: '2026-0220',
    emitidoPor: 'Tatiane Viegas',
    dataEmissao: '2026-06-13',
    cliente: 'Escritório Central Sul',
    cnpjCpf: '99.000.111/0001-22',
    endereco: 'Av. Afonso Pena, 1500 — Belo Horizonte/MG',
    contato: 'Reclamante (31) 98765-0001',
    resumo: 'Ruído ambiental medido no interior do imóvel afetado (NBR 10151 – ambiente interno)',
    frequencia: 'Pontual',
    rota: 'Belo Horizonte/MG',
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
