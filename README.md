# MYP Cards Price Comparator

Ferramenta de uso pessoal para comparação e monitoramento de preços de cartas de Yu-Gi-Oh! anunciadas no MYP Cards.

## Objetivo

Comparar os preços dos meus próprios anúncios com referências de mercado da API oficial do MYP Cards, facilitando a identificação de preços acima ou abaixo do mercado e a manutenção da minha pasta de vendas. O aplicativo não é um marketplace nem um serviço de revenda de dados.

## Funcionalidades previstas

- Consulta individual e atualização em lote de referências.
- Identificação por nome, edição e identificador do produto.
- Comparação por idioma e conservação quando esses dados estiverem disponíveis.
- Exibição de diferenças de preço e filtros para revisão manual.
- Cache local, controle de frequência e retomada de consultas interrompidas.
- Teste de conexão e configuração segura da chave da API.

## Integração

A integração autenticada está em planejamento, condicionada à aprovação do acesso. Endpoints pretendidos: precos, carta, edicoes e produto. O volume inicial estimado é de até 1.000 requisições por dia, sujeito aos limites autorizados e à necessidade real. O aplicativo deverá respeitar os termos de uso, limites de requisição e respostas de rate limiting, sem contornar restrições.

A ferramenta apoia a precificação de anúncios próprios. Não há previsão de cobrar pelo aplicativo ou redistribuir/comercializar os dados coletados.

## Segurança

Credenciais e dados locais não devem ser publicados no GitHub. Consulte o arquivo de configuração de exemplo e a documentação em docs/.

## Status

Comparador em desenvolvimento. Este repositório contém a documentação inicial e a estrutura para a futura integração oficial; o código do protótipo existente ainda não foi publicado.

## Fonte dos dados

[MYP Cards](https://mypcards.com/) — a atribuição deverá aparecer de forma visível junto às referências exibidas.

[Documentação oficial da API](https://mypcards.github.io/mypcards-api/)

Projeto independente, sem vínculo oficial com o MYP Cards.
