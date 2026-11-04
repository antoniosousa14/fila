# Segurança

## Como reportar uma vulnerabilidade

**Não abras um *issue* público.** Usa o relatório privado do GitHub: no separador **Security** do repositório,
*Report a vulnerability*. Diz o que encontraste, como reproduzir e que impacto vês.

## O que a Fila promete

- O gestor só escuta em `127.0.0.1` e os pedidos que alteram alguma coisa exigem uma origem local.
- Só **lê** os dados do Claude (sessões, grupos, transcrições). Não altera chats nem grupos.
- O `claude_desktop_config.json` só é lido para os grupos: os servidores MCP e as suas chaves nunca chegam à API.
- Nenhum dado dos chats sai da máquina. Os únicos pedidos de rede são a taxa de câmbio do BCE e os tipos de letra
  da página do gestor.

Um problema que quebre alguma destas promessas conta como vulnerabilidade.
