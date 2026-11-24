# Plano de integração com MYP Cards

## Escopo
Consultar referências para os próprios anúncios de Yu-Gi-Oh!, sem redistribuição de dados. Documentação oficial: https://mypcards.github.io/mypcards-api/

## Fluxo proposto
1. Importar a lista de anúncios do usuário.
2. Identificar a carta e sua edição, usando identificadores oficiais quando disponíveis.
3. Consultar referências ausentes ou expiradas no cache.
4. Comparar somente versões equivalentes; sinalizar correspondências ambíguas ou referências indisponíveis.
5. Exibir preço anunciado, referência, diferença percentual, data da consulta e atribuição com link https://mypcards.com/.
6. Permitir atualização individual e em lote, sem alteração automática dos anúncios.

## Consumo responsável
- Deduplicar consultas por identificador e reutilizar resultados em cache.
- Respeitar os limites concedidos; não assumir que a autenticação elimina limites.
- Em HTTP 429, respeitar Retry-After quando presente e suspender a fila conforme necessário.
- Registrar falhas sem expor segredos e permitir retomada.
- Confirmar formatos, autenticação, granularidade de preços e condições de armazenamento na documentação oficial antes da implementação.

## Segurança
Manter a chave fora do repositório e de código público de frontend. Quando necessário, utilizar um componente local ou backend que faça as consultas autenticadas. Não registrar tokens em logs.

## Status
Planejamento inicial; acesso autenticado ainda não aprovado e integração não testada.
