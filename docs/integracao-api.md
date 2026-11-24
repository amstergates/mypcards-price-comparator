# Integração com o MYP Cards

## API de preços gerais

O painel **Preços gerais pela API pública** usa as estatísticas oficiais do MYP Cards, sempre em modo anônimo. Ele consulta páginas do catálogo de Yu-Gi-Oh! com até 50 produtos enquanto elas trazem pelo menos dois itens pendentes da pasta. Quando uma página rende menos, a consulta segue por ID ou pelo código informado na lista. O comparador deduplica produtos, reutiliza respostas por uma hora e preserva resultados recebidos se a consulta for pausada.

| Consulta | Endpoint oficial |
|---|---|
| Página do catálogo | `GET /api/v1/yugioh/precos?page_number=1&page_size=50` |
| Preços por ID | `GET /api/v1/produto/{id_produto}` |
| Preços por código | `GET /api/v1/yugioh/precos/{codigo_base64}` |
| Busca por nome usada para identificar cartas | `GET /api/v1/yugioh/carta/{nome}` |
| Checagem de conexão | `GET /api/v1/jogos` |

A [página de acesso à API](https://mypcards.com/acesso-api) informa 10 requisições por minuto sem token e 60 com token. O painel público inicia chamadas com intervalo mínimo de 6,5 segundos e pausa após HTTP 429, respeitando o prazo indicado em `Retry-After`. Uma consulta pode ser retomada preservando os resultados já recebidos.

O menor preço e a média ponderada são agregados de ofertas anunciadas. Podem incluir o próprio anúncio e misturar condições e idiomas. A média de vendas concluídas, quando informada pelo usuário, é um dado separado usado apenas para a sugestão de preço.

## Coleta de ofertas equivalentes

**Completar referências** usa a aba do MYP Cards conectada pelo favorito. O comparador filtra ofertas pela variante, conservação e idioma quando identificados e exclui seus próprios anúncios. As referências recebidas são exibidas e salvas durante a coleta. Uma coleta parcial conserva esse rótulo até a cobertura ser confirmada. O app pode reutilizar um backup JSON ou uma planilha de referências quando a consulta direta estiver indisponível.

## Token opcional no servidor local

Após a aprovação pelo MYP Cards, copie `.env.example` para `.env`, preencha `MYP_API_TOKEN` e reinicie `npm run dev`. O servidor envia o token no cabeçalho `X-Api-Token` somente para endpoints oficiais que o aceitam no fluxo implementado. Neste código, ele é usado na identificação de cartas pelo catálogo e no teste de conexão com a API. O painel **Preços gerais pela API pública** continua anônimo, com seu próprio controle de frequência.

O arquivo `.env` é ignorado pelo Git. O token fica no servidor. A integração não escreve no estoque nem atualiza anúncios.

Documentação oficial: [API do MYP Cards](https://mypcards.github.io/mypcards-api/).
