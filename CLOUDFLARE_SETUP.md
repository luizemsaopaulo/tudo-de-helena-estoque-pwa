# Tudo de Helena — sincronização Cloudflare

- Front-end público: GitHub Pages (mesmo endereço anterior).
- API privada: Cloudflare Workers (`tudo-de-helena-estoque-api`).
- Banco: Cloudflare D1 (`tudo-de-helena-estoque-db`).
- Conta Cloudflare de destino: `lucileneluizwl@outlook.com` (Account ID `5491223693d8ab2f8073676e0df26469`).
- Worker publicado na conta de destino: `https://tudo-de-helena-estoque-api.tudo-de-helena-luizwl.workers.dev`.
- O certificado HTTPS do novo `workers.dev` foi ativado após a criação. `/api/health` retornou HTTP 200 com TLS válido; os testes de login com PIN, sessão, importação, atualização, exclusão, controle de origem e logout na API REAL passaram em 13/11/2026.
- Banco D1 de destino: ID `26de154b-7f6f-4c95-a15a-6e6a3ce160a4` (novo, esquema aplicado).
- Código de API: `cloudflare/worker.js`.
- Acesso: senha do servidor em segredo `ADMIN_PASSWORD` (NUNCA commitar a senha).
- Sessões: expiração renovável por mais 30 dias durante o uso regular, sem pedir senha a cada abertura no mesmo navegador; token aleatório de 256 bits, hash SHA-256 guardado no D1.
- Bloqueio: 5 tentativas erradas por IP e limite global de 80 falhas em 15 minutos; índice no D1 por horário para consultas.
- A senha curta escolhida pelo usuário é configurada somente como segredo `ADMIN_PASSWORD` do Worker, nunca embutida em código ou commit. Senhas de seis dígitos são mais vulneráveis do que senhas longas; considere atualizar para uma senha maior futuramente.
- Sincronização: local-first com fila IndexedDB; download do servidor a cada 30 segundos.
- Segurança de dados: a atualização local e sua entrada na fila usam uma única transação; o recebimento da nuvem valida a fila dentro da transação de substituição para evitar sobrescrever edições pendentes.
- Depuração no VS Code: abra o projeto e use **Executar e Depurar** (F5), selecionando `Depurar Tudo de Helena — site publicado` ou `— local`. O perfil local inicia automaticamente o servidor Python.
- Verificações automatizadas no Lenovo (13/11/2026): JavaScript válido e teste de integração entre dois navegadores (cadastro, atualização offline, reconexão, exclusão e erros em console) aprovado usando API simulada. Testes anteriores da API Cloudflare de produção também foram aprovados.
- **Primeira conexão:** o usuário deve escolher enviar os cadastros locais à nuvem ou usar o servidor. O aplicativo exporta backup JSON antes de qualquer substituição.
- Nesta migração as chaves locais de autenticação e importação têm prefixo `helena.cloud.lucileneluizwl.*.v3`, para não confiar automaticamente na sessão da conta antiga. A fila de alterações do servidor anterior é limpa apenas após backup e importação (se selecionada), para impedir a reprodução de valores obsoletos na nova nuvem. Teste automatizado validou a importação de dados existentes, fila antiga e reconexão offline. Importar dados do navegador com cadastro previamente existente; não apagar o banco antigo.
- Importação inicial usa INSERT OR IGNORE; registros remotos existentes são mantidos em conflitos de IDs.
- Excluir registro na nuvem mantém tombstone; dados locais só são reconciliados após envio das alterações pendentes.
- Limite do D1: 2 MB por registro; fotos grandes são redimensionadas a JPEG para sincronizar.
- O endereço físico-base na aba Configurações segue local ao navegador (não foi migrado).
- Alterações simultâneas sobre *o mesmo registro* podem resultar em última gravação prevalecendo; não é controle transacional multiusuário.

## Instalação

1. Confirmar verificação do e-mail na conta Cloudflare.
2. `wrangler d1 execute tudo-de-helena-estoque-db --remote --file cloudflare/schema.sql`
3. `wrangler deploy`
4. `wrangler secret put ADMIN_PASSWORD` (segredo de alta entropia).
5. `wrangler secret list` para confirmar, sem exibir o valor.
6. Testar `/api/health`, login, leitura/gravação e permissões.
7. Só depois publicar o repositório GitHub Pages.

## Precauções

Não colocar token, senha ou backup de clientes no GitHub. Em caso de instabilidade, o aplicativo continua usando IndexedDB e preserva as operações pendentes. Para recuperação, importar backup JSON pela interface.
