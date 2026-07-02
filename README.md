# eCamp — App de campo da ENGEAR Laboratório

PWA offline-first para registro de monitoramentos ambientais em campo.
**Stack:** HTML5 + JavaScript puro (sem frameworks) · localStorage · hospedagem em GitHub Pages.

> **Status: Fase 0 concluída** — fundação do app (PWA offline, login, navegação, componentes transversais). Os formulários de campo entram nas próximas fases.

## Estrutura de pastas

```
E-CAMP/
├── index.html            ← todas as telas (login, escolha da ação, placeholders, bancada de teste)
├── manifest.json         ← manifesto do PWA (instalável no celular)
├── service-worker.js     ← cache do app shell (abre offline)
├── css/
│   └── estilos.css
├── js/
│   ├── app.js            ← orquestração: login, navegação, header, online/offline
│   ├── storage.js        ← utilitários de localStorage (salvar/ler/listar/remover)
│   ├── esquemas.js       ← fonte única da verdade dos dados por tipo (esqueleto; Fases 2 e 4)
│   └── componentes/      ← componentes transversais reutilizáveis
│       ├── gps.js        ← captura GPS + conversão UTM + endereço (geocode mockado)
│       ├── foto.js       ← foto com carimbo UTM + nomenclatura + base64
│       ├── navegacao.js  ← botões 💾 Salvar rascunho · ← Voltar · Próximo →
│       ├── paginacao.js  ← navegação entre pontos (P1, P2, …)
│       ├── alerta-vento.js ← alerta amarelo se vento ≥ 5 m/s
│       └── checagens.js  ← alerta vermelho se diferença entre checagens ≥ 0,5 dB
└── public/
    ├── logo.png
    ├── icone-192.png     ← ícones do PWA (gerados a partir do logo)
    └── icone-512.png
```

Cada componente tem, no topo do arquivo, um comentário explicando a **interface** (o que recebe e o que devolve) — é por ela que os formulários das Fases 1+ vão chamá-los.

## Como testar

O PWA (service worker, GPS, câmera) exige **HTTPS ou localhost** — não funciona abrindo o arquivo direto do disco.

**No computador (rápido):** com Python instalado, rode na pasta `E-CAMP`:

```
python -m http.server 8080
```

e abra http://localhost:8080 no navegador.

**No celular (teste real):** publique a pasta no GitHub Pages (repositório `monitoramento-engear`) e acesse pela URL do Pages. No Android/Chrome ou iOS/Safari, use "Adicionar à tela de início" para instalar.

### Roteiro de aceite da Fase 0

1. Instalar no celular, ativar **modo avião** → o app abre normalmente.
2. Login com a senha do app entra; senha errada mostra erro; "Salvar senha" persiste ao recarregar.
3. **Serviços** abre o placeholder do fluxo; **Reembolso** abre o pedido de reembolso (OS + despesa + foto do comprovante); **Agenda** mostra "Disponível na Fase 2".
4. Header presente em todas as telas; 🕐 📝 📅 📚 abrem overlays-placeholder; o chip do usuário faz logout.
5. Na bancada "🧪 Testar componentes": **Capturar GPS** devolve UTM + precisão; a foto sai **carimbada** com UTM/OS/tipo/ponto e nome `OS_..._AAAAMMDD_HHMMSS.jpg`.
6. Recarregar a página mantém a sessão.
7. Ao ficar offline, a barra amarela de pendências aparece.

## Convenções (valem para todo o projeto)

- **Chaves do localStorage por prefixo:** `sessao:` · `rascunho:` · `historico:` · `pending:` (sempre via `EC.storage`).
- **Namespace global:** todos os módulos se penduram em `window.EC` (ex.: `EC.gps.criar(...)`).
- **Caminhos sempre relativos** (GitHub Pages).
- **Sem frameworks.** JavaScript puro, módulos pequenos e isolados.
- **esquemas.js é a fonte única da verdade** dos campos/colunas por tipo de monitoramento — nenhuma definição de coluna fora dele.
- Ao mudar qualquer arquivo do app shell, **trocar `VERSAO_CACHE`** em `service-worker.js` para o PWA instalado se atualizar.

## Próximas fases

1. **Fase 1** — fluxo de serviço base (OS mockada, dados gerais, 6 cards, placeholders dos passos).
2. **Fase 2** — Ruído completo (piloto) · **Fase 3** — PDF · **Fase 4** — demais tipos.
3. **Fase 5** — rascunhos/histórico/pendentes/biblioteca · **Fase 6** — SGE (F021) · **Fase 7** — sincronização SharePoint.

> **Segurança (Fase 7):** o Azure Client Secret **nunca** entra neste repositório — vive só como variável de ambiente do Cloudflare Worker.
