# Organização atual do workspace

A pasta `app/` contém o repositório do sistema completo, com interface e servidor. Foi renomeada de `front-end/` em 7 de outubro de 2026, preservando o histórico Git e as alterações locais.

```text
app/
  src/          # interface
  server/       # serviços do servidor
  supabase/     # histórico de migrações e procedimento de versionamento
  database/     # scripts SQL históricos de referência
  deploy/       # configuração de hospedagem
  public/       # recursos do aplicativo
  tests/        # testes
context/       # documentação operacional e registros de recuperação
backups/ # ZIP histórico e verificação de integridade
```

Executar os comandos de desenvolvimento a partir de `app/`. A estrutura interna do código permanece inalterada. As referências ao nome anterior em documentos históricos descrevem a organização da época.

O ZIP em `../backups/` preserva o conteúdo original do backup; sua pasta interna foi renomeada para `app/`. Ele não recebe novos commits automaticamente e antecede a importação das migrações. Banco, credenciais e arquivos privados do Storage não estão incluídos no ZIP.

O histórico do Git pertence à aplicação. Alterações verificadas recebem commits locais conforme AGENTS.md; o envio ao GitHub depende de autorização. Renomear as pastas externas não altera o código publicado.

## Directory naming

Use lowercase English directory names and hyphens for multiword names. The workspace uses `app/` for the application repository, `context/` for operational documentation, and `backups/` for historical archives. Inside `context/`, use `docs/technical/`, `docs/history/`, `deployment/`, `recovery/`, and `security-audits/`. Existing runtime directories (`src/`, `server/`, `supabase/`, `deploy/`, etc.) retain their names. Archival documents and recovery patches may reference previous directory names.
