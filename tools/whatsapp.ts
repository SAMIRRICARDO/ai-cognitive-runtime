export async function notifyWhatsApp(message: string): Promise<void> {
  const phone = '5511953577804';
  const apiKey = process.env.CALLMEBOT_API_KEY;

  if (!apiKey) {
    console.warn('⚠️  CALLMEBOT_API_KEY não configurada');
    console.log('📋 RELATÓRIO:\n', message);
    return;
  }

  const encoded = encodeURIComponent(message);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`;

  const res = await fetch(url);
  if (res.ok) {
    console.log('✅ Relatório enviado via WhatsApp');
  } else {
    console.error('❌ Erro ao enviar WhatsApp:', res.status);
  }
}
