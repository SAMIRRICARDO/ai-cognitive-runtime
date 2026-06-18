export async function notifyTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '8135843555';

  if (!token) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN não configurada');
    console.log('📋 RELATÓRIO:\n', message);
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    })
  });

  if (res.ok) {
    console.log('✅ Relatório enviado via Telegram');
  } else {
    console.error('❌ Erro Telegram:', res.status);
  }
}
