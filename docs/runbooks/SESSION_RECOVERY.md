# Runbook — Recuperação da sessão WhatsApp QR

O volume `/data/whatsapp-auth` contém material de sessão sensível.

## Regras

- nunca versionar ou anexar o conteúdo;
- nunca copiar a sessão de produção para staging;
- manter `ADMIN_TOKEN`, notify secret e shared secret separados;
- redigir headers e erros nos logs;
- preferir Meta WhatsApp oficial quando disponível.

## Reconexão

1. confirmar que apenas uma instância controla a sessão;
2. pausar notificações do serviço central;
3. abrir o painel autenticado;
4. realizar a conexão por QR humanamente;
5. confirmar health sem expor credenciais;
6. retomar notificações e executar mensagem de teste autorizada.

CAPTCHA, bloqueio ou desafio do WhatsApp não deve ser contornado.
