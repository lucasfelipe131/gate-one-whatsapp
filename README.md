# Gate One WhatsApp

Serviço separado de atendimento do Gate One Pro por QR Code. Ele mantém a sessão em um Volume da Railway e consulta o Gate One por uma API interna protegida por segredo compartilhado.

## Publicar na Railway

1. Crie um repositório GitHub chamado `gate-one-whatsapp` e envie esta pasta.
2. Na Railway, crie **New Project → Deploy from GitHub Repo** e selecione o repositório.
3. Em **Variables**, preencha os valores de `.env.example` e gere um `ADMIN_TOKEN` com mais de 24 caracteres.
4. Em **Storage**, adicione um Volume montado em `/data`.
5. Gere um domínio público e abra-o. Informe o `ADMIN_TOKEN` no primeiro acesso, clique em **Gerar QR Code** e leia o QR pelo WhatsApp.

## Aviso de pagamento para o responsável

No serviço `gate-one-whatsapp`, configure `GATE_ONE_NOTIFY_SECRET` (24+ caracteres).
No Gate One principal, configure os três valores abaixo:

- `GATE_ONE_WHATSAPP_QR_URL`: domínio público deste serviço, sem barra final.
- `GATE_ONE_WHATSAPP_NOTIFY_SECRET`: o mesmo segredo acima.
- `GATE_ONE_OWNER_WHATSAPP`: seu número com DDI e DDD, por exemplo `5555999999999`.

Quando o Mercado Pago confirmar, o Gate One enviará pelo WhatsApp conectado um aviso com nome, ID Gate One, login, plano e valor do cliente.

O catálogo é consultado diretamente no Gate One principal. Assim, o bot exibe
e cobra sempre os mesmos valores do painel:

- Mensal: R$ 30;
- Trimestral: R$ 85;
- Semestral: R$ 150;
- Anual: R$ 270.

Na renovação, o cliente primeiro escolhe o ciclo. Ele pode responder com o
nome do plano ou com `30`, `85`, `150` ou `270` para receber o Checkout Pro
correspondente.

Números ainda não cadastrados recebem um pedido de nome. Quando existe um
cadastro antigo com o mesmo nome em outro telefone, o bot pede também o
login/ID do Gate One antes de vincular e mostrar dados. Mensagens recebidas,
respostas e problemas detectados ficam no histórico central do Gate One.

A opção `5`/`NOVIDADES` consulta o resumo diário de conteúdos sincronizados do
canal do Telegram configurado no sistema principal.

## Integração com Gate One

O Gate One principal expõe rotas internas protegidas por `X-Gate-One-Bot-Secret`:

- `POST /api/integrations/whatsapp/plans`
- `POST /api/integrations/whatsapp/customer`
- `POST /api/integrations/whatsapp/payment`
- `POST /api/integrations/whatsapp/inbound`
- `POST /api/integrations/whatsapp/name`
- `POST /api/integrations/whatsapp/login`
- `POST /api/integrations/whatsapp/history`
- `POST /api/integrations/whatsapp/content`
- `POST /api/integrations/whatsapp/assistant`
- `POST /api/integrations/whatsapp/outbound`

Todas usam o mesmo valor de `GATE_ONE_SHARED_SECRET` e nunca devem ficar
abertas sem autenticação.

## Limites

QR Code usa uma sessão do WhatsApp Web, não a API oficial da Meta. Mantenha atendimento humano para casos delicados e não use disparos em massa.
