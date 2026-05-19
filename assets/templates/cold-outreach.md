# Cold Outreach Template — VRASHOWS

**Versão:** 2.0 — 2026-05-19 (validado em envios reais)
**Uso:** Primeiro contato com decisor de marketing/eventos enterprise.
**Attachment:** vrashows_media_kit_optimized.pdf (obrigatório)
**Tom:** Executivo, elegante, peer-to-peer. Zero pressão de vendas.
**Posicionamento:** HUB premium de soluções integradas — não agência, não fornecedor.

---

## Subject line options

- `Operação premium para eventos corporativos`
- `VRASHOWS — Operação integrada para [Evento] [Ano]`
- `[Empresa] — suporte 360° para sua próxima feira`
- `Operação sem improvisos para eventos enterprise`
- `[Nome], parceria operacional para [Evento] [Ano]`

---

## Body (PT-BR) — Versão oficial v2.0

```
[Nome],

Grandes eventos corporativos exigem muito mais do que execução operacional. Exigem controle, velocidade de resposta e uma experiência consistente do início ao fim — mesmo quando dezenas de fornecedores, equipes e demandas acontecem simultaneamente.

É exatamente nesse cenário que a VRASHOWS atua.

Somos um hub de soluções integradas para eventos corporativos e experiências de marca, assumindo toda a operação para que sua equipe possa concentrar energia no que realmente importa: relacionamento, negócios e resultado.

Coordenamos de forma integrada:
• logística operacional
• staff premium
• produção executiva
• hospitality
• suporte 360° em tempo real
• experiência do visitante

Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.

[SEGMENT INSERT — ver abaixo]

"Enquanto você fecha negócios, nós controlamos a operação."

Na ABRINT 2026, atuamos ao lado da Brasil TecPar conduzindo toda a operação do evento com foco em fluidez operacional, experiência do público e suporte integral à equipe da marca — reduzindo ruído operacional e permitindo total foco em networking e geração de negócios.

Estou encaminhando em anexo nosso material institucional com mais detalhes sobre a estrutura e metodologia da VRASHOWS.

Se fizer sentido para o momento da sua empresa, ficarei à disposição para uma conversa breve nos próximos dias.
```

---

## Personalization slots

- `[Nome]` — primeiro nome do contato (usado apenas na abertura)
- `[Empresa]` — nome da empresa
- `[Evento]` — evento específico (ex: Futurecom 2026, AWS Summit)
- `[SEGMENT INSERT]` — inserir após os bullets e antes da tagline

---

## Segment inserts (inserir antes da tagline)

**Telecom / Conectividade:**
> Para marcas de conectividade como a [Empresa], a presença em feiras como [Evento] é ela mesma uma declaração de confiabilidade — a operação no estande precisa refletir o mesmo padrão que a rede promete.

**Cloud / Enterprise SaaS:**
> Empresas de tecnologia precisam que a experiência no evento reflita a mesma excelência que a marca promete digitalmente — seamless, premium e sem fricção operacional. Um gap aqui é visível para quem mais importa.

**AI / Cibersegurança:**
> Empresas deste setor precisam de ambientes controlados e de alta confiança para demos, briefings executivos e reuniões estratégicas — sem espaço para improviso ou ruído operacional.

**Fintech / Finance:**
> Marcas financeiras enterprise precisam de uma operação que reflita solidez institucional e hospitalidade de alto nível — o padrão que os seus clientes e parceiros esperam ao visitar o estande.

**Marketing / Brand Activation:**
> Ativações de marca exigem uma operação que some — invisível para o visitante, integralmente controlada nos bastidores, para que a experiência seja tudo que a marca quer transmitir.

**Generic / Default:**
> Uma operação integrada como essa reduz o ruído operacional no dia do evento — permitindo que o time de [Empresa] esteja 100% focado em networking, geração de negócios e relacionamento com clientes.

---

## HTML version — key structural elements

When generating `bodyHtml`, use this structure (without `<html>`/`<body>` tags):

```html
<p>[Nome],</p>
<p>Grandes eventos corporativos exigem muito mais do que execução operacional...</p>
<p>É exatamente nesse cenário que a VRASHOWS atua.</p>
<p>Somos um hub de soluções integradas...</p>
<p>Coordenamos de forma integrada:</p>
<ul style="margin:0 0 16px;padding-left:20px;line-height:1.8;">
  <li>logística operacional</li>
  <li>staff premium</li>
  <li>produção executiva</li>
  <li>hospitality</li>
  <li>suporte 360° em tempo real</li>
  <li>experiência do visitante</li>
</ul>
<p>Tudo com acompanhamento próximo, agilidade operacional e execução sem improvisos.</p>
<p>[SEGMENT INSERT]</p>
<p style="background:#f8fafc;border-left:3px solid #0f172a;padding:12px 16px;margin:20px 0;font-style:italic;color:#334155;"><em>"Enquanto você fecha negócios, nós controlamos a operação."</em></p>
<p>Na ABRINT 2026, atuamos ao lado da Brasil TecPar conduzindo toda a operação...</p>
<p>Estou encaminhando em anexo nosso material institucional...</p>
<p>Se fizer sentido para o momento da sua empresa, ficarei à disposição para uma conversa breve nos próximos dias.</p>
<p style="margin:24px 0 0;"><a href="https://vrashows.com.br" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:4px;text-decoration:none;letter-spacing:0.3px;">Vamos conversar →</a></p>
```

---

## Rules

- Maximum 220 words in body (full version); 100 words for C-level
- Never lead with "staff" or "promotores" as the value prop
- Always use the tagline explicitly: "Enquanto você fecha negócios, nós controlamos a operação"
- Always write "Na ABRINT 2026" — never "No ABRINT"
- Always attach media kit PDF
- CTA: soft, no urgency, no "I'd love to", no "adoraria conversar"
- Name used only once (in the greeting)
- Never use: "agência", "fornecedor", "terceirização", "prestação de serviço"
- Links in HTML: vrashows.com.br must be clickable
