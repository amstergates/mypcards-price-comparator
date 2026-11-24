# Estrutura do código

| Caminho | Responsabilidade |
|---|---|
| [public/](../public/) | Interface, importação, filtros, cálculo dos preços e cache local da API pública |
| [scripts/collect-browser-myp.mjs](../scripts/collect-browser-myp.mjs) | Coleta pela aba do MYP, paginação, controle de frequência e envio progressivo das ofertas |
| [scripts/coletar-ofertas-myp.mjs](../scripts/coletar-ofertas-myp.mjs) | Coletor de linha de comando distribuído pelo build |
| [worker/](../worker/) | Rotas de leitura, validação de respostas e parser das páginas públicas do MYP Cards |
| [build.mjs](../build.mjs) | Gera `dist/server/index.js` e inclui o código do favorito |
| [preview.mjs](../preview.mjs) | Servidor HTTP local |

O aplicativo utiliza JavaScript ES Modules. Veja o [README principal](../README.md) para rodar o projeto.
