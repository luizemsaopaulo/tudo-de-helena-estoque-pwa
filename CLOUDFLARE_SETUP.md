# Tudo de Helena — sincronização Cloudflare

- Front-end público: GitHub Pages (mesmo endereço anterior).
- API privada: Cloudflare Workers (`tudo-de-helena-estoque-api`).
- Banco: Cloudflare D1 (`tudo-de-helena-estoque-db`).
- Conta Cloudflare: conta de trabalho autenticada no Wrangler (não incluir dados da conta no repositório público).
- Código de API: `cloudflare/worker.js`.
- Acesso: senha do servidor em segredo `ADMIN_PASSWORD` (NUNCA commitar a senha).
- Sessões: 30 dias; token aleatório de 256 bits, hash SHA-256 guardado no D1.
- Bloqueio: 8 tentativas de senha por IP a cada 15 minutos.
- Sincronização: local-first com fila IndexedDB; download do servidor a cada 30 segundos.
- **Primeira conexão:** o usuário deve escolher enviar os cadastros locais à nuvem ou usar o servidor. O aplicativo exporta backup JSON antes de qualquer substituição.
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
