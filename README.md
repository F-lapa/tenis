# Tennis Dashboard — Ranking ATP no GitHub Pages

Este projeto evita o bloqueio `Failed to fetch` do navegador:

1. O **GitHub Actions** abre a página oficial da ATP em um navegador de servidor.
2. O ranking é salvo em `data/ranking.json`.
3. O **GitHub Pages** publica o HTML e o JSON no mesmo domínio.
4. O sistema lê apenas `./data/ranking.json`, portanto não sofre bloqueio CORS.

## Instalação

1. Crie um repositório novo no GitHub.
2. Extraia este ZIP e envie **todo o conteúdo**, incluindo a pasta oculta `.github`.
3. Use a branch `main`.
4. No repositório, entre em **Settings → Pages**.
5. Em **Build and deployment → Source**, escolha **GitHub Actions**.
6. Entre na aba **Actions**.
7. Abra **Atualizar ranking ATP** e clique em **Run workflow**.
8. Aguarde a conclusão.
9. O workflow **Publicar GitHub Pages** será executado automaticamente após a atualização.

O endereço será semelhante a:

`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`

## Atualização automática

O ranking é consultado aproximadamente a cada 30 minutos. Execuções agendadas do GitHub podem sofrer algum atraso.

## Segurança contra falhas

- O script só substitui o JSON quando reconhece pelo menos 20 jogadores.
- Se a ATP não responder ou mudar o HTML, a última classificação válida é preservada.
- O sistema não inventa jogadores nem posições oficiais.
- Fernando Lapa é incluído apenas como **posição projetada**, calculada pelos pontos registrados no dashboard.

## Teste local opcional

O HTML não deve ser aberto por duplo clique. Para testar localmente:

```bash
python -m http.server 8000
```

Depois abra:

`http://localhost:8000`

## Diagnóstico

Caso o ranking não apareça:

1. Abra **Actions → Atualizar ranking ATP**.
2. Confira se a execução ficou verde.
3. Abra o log **Consultar ATP e gerar JSON**.
4. Verifique se `data/ranking.json` possui jogadores.
