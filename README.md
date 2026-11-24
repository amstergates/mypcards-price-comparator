# Comparador de preços MYP Cards
Comparador pessoal de preços para revisar uma pasta de cartas de Yu-Gi-Oh! em lote. Mostra o preço do anúncio, o menor preço comparável, a média das ofertas, o teto com tolerância e uma sugestão de preço para revisão manual.

## Rodar localmente

Use Node.js 22.9 ou superior. O projeto não tem dependências de instalação.

```bash
git clone https://github.com/amstergates/mypcards-price-comparator.git
cd mypcards-price-comparator
npm run build
npm run dev
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). Clique em **Carregar exemplo** para testar com cartas fictícias. Para usar sua pasta, importe um CSV, TSV ou TXT, cole a lista na interface ou informe a URL da sua vitrine do MYP Cards. O app disponibiliza modelos de arquivos.

## Revisar a pasta

- **Ver preços da minha pasta** cruza a lista carregada com referências salvas ou importadas. Os resultados mostram quais preços pedem revisão e sinalizam quando faltam ofertas. Use **Até R$ 1** para filtrar as cartas mais baratas e **Exportar CSV** para baixar a seleção.
- **Completar referências** consulta em lote os produtos com coleta incompleta. As ofertas chegam à tabela conforme são lidas. O progresso mostra quantos produtos foram percorridos e quantos foram salvos neste navegador.
- **Consultar referência**, na linha da carta, lê a primeira página. Se houver mais ofertas, o resultado é parcial. Durante uma pausa imposta pelo MYP Cards, o app usa a referência salva, quando disponível.
- **Preços gerais pela API pública** exibe menor preço e média ponderada dos anúncios do produto. Use esses valores como referência geral, pois a API pode agrupar condições e idiomas e incluir seu próprio anúncio. Veja [como funciona a integração](docs/integracao-api.md).

## Conectar ao MYP Cards pelo navegador

1. Na aba **Vitrine MYP**, informe a URL da sua vitrine de Yu-Gi-Oh!.
2. Em **Configurar o favorito do MYP no Chrome**, salve **Conectar comparador MYP** na barra de favoritos.
3. Clique em **Conectar ao MYP** no comparador e acione o favorito na aba do MYP que abrir. Mantenha as duas abas abertas para receber as referências.

A coleta usa páginas de leitura, exclui seus próprios anúncios na comparação de ofertas equivalentes e respeita a espera informada pelo MYP Cards. **Parar coleta** mantém disponíveis as ofertas que já chegaram e foram salvas. Na aba da vitrine também é possível baixar um backup JSON para importar de volta no comparador.

## Dados locais

A pasta e os resultados ficam no navegador. A opção **Preparar atualização** só prepara o valor para revisão manual. O comparador não grava alterações no MYP Cards.

O repositório não inclui capturas reais nem credenciais. Para usar um backup, prefira **Importar backup de uma coleta do MYP** no app. Em um build local, é possível incluir `data/vitrine.json` (objeto com `seller` e `rows`) e `data/ofertas-myp.json` (objeto com `seller` e `products`). O build incorpora esses arquivos quando presentes. Mantenha-os no seu ambiente local.

## Código e fontes

Veja a [estrutura do código](src/README.md) e a [documentação da API](docs/integracao-api.md).

As referências são atribuídas ao [MYP Cards](https://mypcards.com/) onde aparecem no app. Projeto independente, sem vínculo oficial com o MYP Cards.
