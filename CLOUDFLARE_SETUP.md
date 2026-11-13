# Tudo de Helena — sincronização Cloudflare

- Front-end público: GitHub Pages (mesmo endereço anterior).
- API privada: Cloudflare Workers (`tudo-de-helena-estoque-api`).
- Banco: Cloudflare D1 (`tudo-de-helena-estoque-db`).
- Conta Cloudflare de destino: `lucilenetudodehelena@hotmail.com` (Wrangler autenticado).
- Worker de destino (ainda não publicado por bloqueio Cloudflare 10034): `https://tudo-de-helena-estoque-api.tudo-de-helena-lucilene.workers.dev`.
- O site público permanece apontando para o Worker antigo `luizemsaopaulo.workers.dev` até o novo funcionar.
- Banco D1 de destino: ID `a07fd805-124a-4853-859b-4ae35f9e5ff3` (esquema existente; zero registros ativos na inspeção em 13/11/2026).
- Código de API: `cloudflare/worker.js`.
- Acesso: senha do servidor em segredo `ADMIN_PASSWORD` (NUNCA commitar a senha).
- Sessões: até 30 dias sem uso, renovadas automaticamente nos acessos regulares quando faltam menos de 15 dias; token aleatório de 256 bits, hash SHA-256 guardado no D1. No mesmo navegador, a sessão fica salva sem digitar a senha a cada abertura.
- O novo login aceita PIN de seis dígitos; é menos resistente que uma senha longa. Com PIN, limita cinco falhas por IP e 80 falhas totais por janela de 15 minutos. O PIN nunca deve entrar no código público: instalar como segredo Cloudflare somente depois da publicação do Worker da Lucilene.
- Bloqueio: 8 tentativas de senha por IP a cada 15 minutos.
- Sincronização: local-first com fila IndexedDB; download do servidor a cada 30 segundos.
- Segurança de dados: a atualização local e sua entrada na fila usam uma única transação; o recebimento da nuvem valida a fila dentro da transação de substituição para evitar sobrescrever edições pendentes.
- Depuração no VS Code: abra o projeto e use **Executar e Depurar** (F5), selecionando `Depurar Tudo de Helena — site publicado` ou `— local`. O perfil local inicia automaticamente o servidor Python.
- Testes anteriores no Lenovo (13/11/2026): JavaScript válido e integração de dois navegadores, cadastro, atualização offline, reconexão, exclusão e console aprovados com API simulada. A API de produção **anterior**, na conta Luiz, também passou nos testes. A API da Lucilene ainda precisa de publicação e testes próprios.
- **Primeira conexão:** o usuário deve escolher enviar os cadastros locais à nuvem ou usar o servidor. O aplicativo exporta backup JSON antes de qualquer substituição.
- O destino Lucilene usa chaves locais próprias (`helena.cloud.lucilene.*.v2`), evitando reutilizar automaticamente a sessão e o marcador de migração da conta Luiz. Dados existentes na nuvem Luiz não são apagados nem copiados automaticamente.
- Importação inicial usa INSERT OR IGNORE; registros remotos existentes são mantidos em conflitos de IDs.
- Excluir registro na nuvem mantém tombstone; dados locais só são reconciliados após envio das alterações pendentes.
- Limite do D1: 2 MB por registro; fotos grandes são redimensionadas a JPEG para sincronizar.
- O endereço físico-base na aba Configurações segue local ao navegador (não foi migrado).
- Alterações simultâneas sobre *o mesmo registro* podem resultar em última gravação prevalecendo; não é controle transacional multiusuário.

## Pendência de liberação da conta Lucilene (13/11/2026)

A conta está autenticada no Wrangler, possui o banco D1 com esquema instalado e o usuário informou ter confirmado o e-mail. No entanto, `wrangler deploy` ainda retorna erro **10034: You need to verify your email address to use Workers**, vindo diretamente da API Cloudflare. Isso também ocorre em outros relatos com e-mails já verificados. Não publicar a alteração no `main` nem apontar o aplicativo público para o Worker Lucilene enquanto a API não for implantada e protegida por segredo.

- Solicitar revisão do estado de verificação da conta: https://dash.cloudflare.com/?to=/:account/support
- Conta Cloudflare ID: `b3ee5a96f15e3f2db9a068617dfa3a94`
- Relato semelhante: https://github.com/cloudflare/developer-platform/issues/25
- O site na produção segue usando a conta Luiz e NÃO foi alterado nesta migração.
- Depois da liberação: publicar Worker, configurar novo `ADMIN_PASSWORD`, testar a API real e migrar dados somente com backup e confirmação na interface; depois integrar a branch à `main`.

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
