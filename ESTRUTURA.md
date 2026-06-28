# eCamp — Estrutura do app (estado atual)

> Resumo de como o app está montado, com foco em **o que abre em cada caso** (escopo × método).
> Publicado em: https://engear.github.io/ecamp-novo/ · Atualizado conforme a Fase 2 (Ruído piloto).

---

## 1. Fluxo geral (telas, em ordem)

```
Login
 → Escolha da ação (Serviços / Reembolso* / Agenda*)   (* Fase 2 do produto)
 → Escolha da OS
 → [Serviços desta OS]   (só aparece se a OS tiver mais de um serviço)
 → Dados gerais do serviço
 → Tipo de monitoramento
 → Seleção de equipamentos
 → Pré-campo / Romaneio
 → "Preparação concluída" (tela de transição)
 → Monitoramento em campo
 → Revisão
 → Finalizar (salva no histórico do aparelho)
```

- **Fases marcadas na tela:**
  - 🧪 **Preparação (laboratório):** dados gerais → tipo → equipamentos → pré-campo
  - 📡 **Em campo:** campo → revisão → finalizar
- **Campanhas em sequência:** uma campanha só libera quando a campanha anterior está toda concluída (as seguintes aparecem com 🔒).
- **Vários serviços por OS:** cada serviço é independente (status 🆕 / ⏸️ / ✅), abre em qualquer ordem dentro da campanha liberada, e vira um registro próprio.

---

## 2. O que ABRE por ESCOPO × MÉTODO (Ruído — único tipo pronto)

> Regra: o **MÉTODO** decide o subtipo (formulário); na falta de método, decide o **escopo**.

| Escopo (OS) | Método (OS) | Tipo | **Formulário que abre** | Observações |
|---|---|---|---|---|
| Ruído Ambiental – NBR 10151 | Ambiente interno | Ruído | **Interno 10151** | nota "monitorar, preferencialmente, **com** pessoas" |
| Ruído Ambiental – NBR 10151 | Ambiente externo | Ruído | **Externo** | |
| Ruído Ambiental – NBR 10151 | Longa duração | Ruído | **Externo (longa duração)** | troca clima por check "monitorar contínuo"; altura ≥ 4 m; itens de longa duração/online viram obrigatórios no pré-campo |
| Ruído Interno – NBR 10152 | (sem método) | Ruído | **Interno 10152** | nota "monitorar, preferencialmente, **sem** pessoas"; período pode ser "Longa Duração" |
| Transportes – Aéreo (NBR 16425-2) | Monitoramento de Receptores Potencialmente Críticos | Ruído | **Aeronáutico** (finalidade já marcada) | 8 checks de instalação |
| Transportes – Aéreo (NBR 16425-2) | Monitoramento Operacional no Aeródromo | Ruído | **Aeronáutico** (finalidade já marcada) | 16 checks; clima vem da estação (só um check) |
| Transportes – Ferroviário (NBR 16425-4) | Passagem de Composição Férrea | Ruído | **Ferroviário** (finalidade já marcada) | 6 checks de instalação |
| Transportes – Ferroviário (NBR 16425-4) | Pátios / Manobras / Cruzamentos | Ruído | **Ferroviário** (finalidade já marcada) | sem checks de instalação |

---

## 3. O que cada formulário de ruído contém (resumo)

- **Externo:** finalidade (Laudo PBH / Obra / Background / Operações / Outros) · por ponto: nome, equipamentos, hora inicial, GPS, posicionamento do microfone (3 checks + item opcional de fachada), montagem (4 checks), checagem inicial + foto da tela, foto do ponto, condições ambientais, ruído residual/total, fontes (empresa/ambiente), checagem final + foto da tela, observações, hora de término.
- **Interno (10151 e 10152):** condição das esquadrias, condição do ambiente, área + "calcular pontos" (1 a cada 30 m²), posicionamento dos pontos (8 checks) + montagem (5 checks), desenho da sala · por ponto: hora, nome, GPS, altura, clima só no 1º ponto, Ltot (2 checks), Lres (3 checks), checagem inicial + foto, foto do ponto, eventualidade, checagem final só no último ponto. **Diferenças do 10151 hoje:** nota "com pessoas" (10152 = "sem pessoas") e, no 1º ponto, escolha obrigatória **Condições do ambiente: ( ) Ambiente vazio ( ) Ambiente mobiliado** (logo antes do bloco de condições ambientais). Resto idêntico — conteúdo específico de cada um a detalhar.
- **Ferroviário:** finalidade · instalação (6 checks, se "Passagem de Composição Férrea") · por ponto: checagens, fotos, checks do ponto (som residual curto/longa, passagem, ambientais), clima.
- **Aeronáutico:** finalidade · instalação (8 ou 16 checks) · por ponto: checagens, fotos; se **operacional** → check "estação meteorológica" (sem clima manual); se **receptores** → clima + 4 checks.

---

## 4. Demais tipos (Fase 4 — ainda placeholder)

Vibração · QAR Externo · QAR Interno · Opacidade · Outro → o **tipo já é pré-selecionado** pelo escopo, mas o **formulário de campo abre "em construção"**.

Métodos no SGE: Vibração = Usual / Online · QAR (MQAR) e Emissões/Ar Interno = sem método.

---

## 5. Regras / travas globais (valem em todo o app)

- **Datas:** sempre DD/MM/AAAA.
- **Fotos:** sempre obrigatórias; **travam a saída do ponto** (não troca de ponto nem avança sem tirar).
- **Salvar:** qualquer item em branco do "Monitoramento em campo" impede salvar — **exceto a hora de término**. Os checks de confirmação também são obrigatórios.
- **Pontos:** vêm da OS; o técnico pode editar, mas com **justificativa**.
- **Equipamentos:** exige ao menos um de cada categoria; **calibração vencida bloqueia a seleção**; vencendo (< 5 dias) só alerta; **Estação Meteorológica** só é obrigatória em longa duração.
- **Pré-campo:** o "Próximo" só libera com os itens obrigatórios marcados (blocos 3 e 4 do ruído são opcionais — viram obrigatórios na longa duração).

---

## 6. "Dados gerais do serviço" — espelha a OS oficial completa

Blocos: **Ordem de serviço** (nº, código, emitido por, data emissão) · **Cliente** (razão social, CNPJ/CPF, endereço, município/UF, contato) · **Local do serviço** (mesmo do contratante) · **Serviço** (serviço, frequência, rota, nº de campanhas) · **Escopo deste serviço** (campanha, escopo, Pontos editável, Dias, Período, Método, Observação) · **Observações da OS** · **Preenchimento** (data/hora).

---

## 7. Pontos em aberto (decidir na planilha)

1. **10151 · Ambiente interno** e **10152** já são subtipos separados (`interno10151` / `interno10152`). Por ora a única diferença é a nota "com/sem pessoas" — falta definir o que mais muda no conteúdo de cada um.
2. **Vibração / QAR Externo / QAR Interno / Opacidade:** definir o conteúdo de cada formulário de campo (Fase 4).
3. **Métodos sem checks próprios** (ex.: Ferroviário "Pátios / Manobras / Cruzamentos") — precisam de checks específicos?

---

## Observações técnicas

- App estático (HTML/JS puro, PWA offline), publicado no GitHub Pages: repositório `ENGEAR/ecamp-novo`, branch `gh-pages`.
- Lista de OS e equipamentos ainda são **mock** (`js/dados-os-mock.js`, `js/equipamentos-mock.js`); a ligação real com o SGE é fase posterior.
- A correlação escopo→método está em `js/mapa-escopo.js`; os formulários de ruído em `js/campo-ruido.js`.
- Há um botão de teste **"🧪 [TESTE] Marcar tudo"** no pré-campo, a ser removido antes de produção.
