const token = sessionStorage.getItem('gateOneWaToken') || prompt('Informe a chave ADMIN_TOKEN do serviço WhatsApp:');
if (token) sessionStorage.setItem('gateOneWaToken', token);
const api = async (path, method = 'GET') => {
  const res = await fetch(path, { method, headers: { 'X-Admin-Token': token } });
  if (!res.ok) throw new Error('Não autorizado ou serviço indisponível.');
  return res.json();
};
const badge = document.querySelector('#badge'), qr = document.querySelector('#qr'), message = document.querySelector('#message');
function render(state) {
  const labels = { connected: 'Conectado', awaiting_qr: 'Aguardando leitura do QR', connecting: 'Conectando', disconnected: 'Desconectado', logged_out: 'Sessão encerrada' };
  badge.textContent = labels[state.status] || state.status;
  badge.className = `badge ${state.connected ? 'ok' : ''}`;
  qr.hidden = !state.qr; if (state.qr) qr.src = state.qr;
  message.textContent = state.connected ? `Conta conectada: ${state.account || 'WhatsApp'}` : (state.lastError || 'Clique em “Gerar QR Code” para conectar.');
}
async function refresh() { try { render(await api('/api/status')); } catch (e) { message.textContent = e.message; } }
document.querySelector('#connect').onclick = async () => { await api('/api/connect', 'POST'); refresh(); };
document.querySelector('#disconnect').onclick = async () => { await api('/api/disconnect', 'POST'); refresh(); };
refresh(); setInterval(refresh, 3000);
