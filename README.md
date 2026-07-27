# Gate One WhatsApp

Serviço separado de atendimento do Gate One Pro por QR Code. Ele mantém a sessão em um Volume da Railway e consulta o Gate One por uma API interna protegida por segredo compartilhado.

## Publicar na Railway

1. Crie um repositório GitHub chamado `gate-one-whatsapp` e envie esta pasta.
2. Na Railway, crie **New Project → Deploy from GitHub Repo** e selecione o repositório.
3. Em **Variables**, preencha os valores de `.env.example` e gere um `ADMIN_TOKEN` com mais de 24 caracteres.
4. Em **Storage**, adicione um Volume montado em `/data`.
5. Gere um domínio público e abra-o. Informe o `ADMIN_TOKEN` no primeiro acesso, clique em **Gerar QR Code** e leia o QR pelo WhatsApp.

## Integração com Gate One

No Gate One principal, crie duas rotas internas protegidas por `X-Gate-One-Bot-Secret`:

- `POST /api/integrations/whatsapp/customer`
- `POST /api/integrations/whatsapp/payment`

As duas rotas devem usar o mesmo valor de `GATE_ONE_SHARED_SECRET` e nunca devem ficar abertas sem autenticação.

## Limites

QR Code usa uma sessão do WhatsApp Web, não a API oficial da Meta. Mantenha atendimento humano para casos delicados e não use disparos em massa.
