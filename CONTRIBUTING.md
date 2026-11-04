# Contribuir para a Fila

Obrigado por quereres ajudar. A Fila é pequena e tem um dono que revê tudo: **ninguém tem escrita direta no
`master`**. Contribui por *pull request* a partir de um fork.

## Antes de começar

- Para um erro ou uma ideia, abre um *issue* primeiro, sobretudo se for uma mudança grande. Poupa trabalho a todos.
- Lê o [README](README.md) e a [referência técnica](docs/referencia.md): têm as peças e como se ligam.

## Fazer uma alteração

1. Faz um fork e cria um ramo a partir do `master`.
2. Mantém a alteração pequena e com um só assunto.
3. Corre os testes (têm de passar todos):

   ```powershell
   node --test "gestor/test/*.test.mjs"                                  # gestor (o padrão leva aspas)
   $C = (Get-ChildItem "$env:APPDATA\Claude\claude-code\*\*\claude.exe" | Sort-Object LastWriteTime)[-1].FullName
   & $C plugin validate mod ; & $C plugin test mod                       # mod
   ```

4. Abre o *pull request* contra o `master`, a explicar o quê e porquê. Quem revê pode pedir mudanças.

## Regras do projeto

- **Português de Portugal**, com acentos, em tudo o que se vê, nos comentários e nos commits.
- Commits em português no estilo `fix(gestor): …`, `feat(mod): …`, `docs: …`.
- **Nunca ponhas dados reais** em testes, exemplos ou capturas de ecrã: nomes de pessoas, clientes ou projetos, e-mails,
  caminhos do teu utilizador, chaves. Usa os dados fictícios de `docs/demo/` (Loja Aurora, App Horizonte, Blog Maré,
  Painel Farol).
- O gestor **só lê** os dados do Claude e só escuta em `127.0.0.1`: não mudes isto.
- Solidez antes de funcionalidades: a app tem de sobreviver a terminais fechados e a reinícios.
- Não acrescentes dependências sem falar antes (o gestor é Node sem dependências de propósito).

## Licença

Ao contribuíres, aceitas que o teu trabalho fica sob a [licença MIT](LICENSE) do projeto.
