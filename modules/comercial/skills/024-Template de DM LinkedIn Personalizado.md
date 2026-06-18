---
name: template-de-dm-linkedin-personalizado
description: Criar e validar templates de DM LinkedIn para o dispatcher do VRAXIA — respeitando o limite de 200 chars para notas de convite e 300 chars para DMs diretas — com variáveis {{nome}} e {{empresa}} para personalização automática, frontmatter YAML e validação dry-run antes do disparo.
tags: [linkedin, template, dm, personalização, copy, 200 chars, convite, mensagem, variáveis]
---

# Template de DM LinkedIn Personalizado

## Objetivo
Criar templates de DM LinkedIn que o dispatcher do VRAXIA usa para personalizar automaticamente cada mensagem — injetando o primeiro nome e empresa de cada lead via `{{nome}}` e `{{empresa}}`. O template deve respeitar o limite de 200 chars para notas de convite (2º/3º grau) ou 300 chars para DMs diretas (1º grau), e ser validado via `--dry-run` antes do disparo.

## Quando usar
- Ao criar uma nova campanha de outbound LinkedIn
- Para personalizar mensagens por evento, vertical ou segmento
- Para validar o número de chars antes de disparar para a lista
- Para criar variações A/B de copy e comparar taxa de resposta

## Como usar
1. Crie o arquivo `.md` em `vault/imprensa/templates/`
2. Use o frontmatter YAML para metadados (não enviado — removido pelo dispatcher)
3. Use `{{nome}}` para primeiro nome e `{{empresa}}` para empresa
4. Valide com `tsx scripts/linkedin_dm_dispatcher.ts --dry-run`
5. Ajuste até todos os leads ficarem dentro do limite de chars

## O Prompt
```
Você é especialista em copy para LinkedIn DMs B2B. Uma mensagem de LinkedIn tem características únicas: é pessoal, sem botão de "spam", e o destinatário sabe que você foi até o perfil dele. A abertura tem que parecer genuína — não um template.

LIMITES RÍGIDOS DO DISPATCHER:
- Nota de convite (2º/3º grau): máximo 200 chars (hardcoded: NOTE_CHAR_LIMIT = 200)
- DM direta (1º grau): máximo 300 chars recomendado
- Variáveis disponíveis: {{nome}} (primeiro nome extraído de `name`) e {{empresa}}
- Frontmatter YAML é removido automaticamente antes do envio

FORMATO DO ARQUIVO:
```markdown
---
tags: [evento/campanha, linkedin, dm]
char_limit: 200
version: 1.0
---
[corpo da mensagem aqui]
```

REGRAS PARA O CORPO:
- Começar com "Olá {{nome}}!" ou variante pessoal
- 1 ideia principal — não listar múltiplos benefícios
- CTA claro: uma ação específica (visitar site, responder, aceitar)
- Sem emojis em excesso (máximo 1-2, se combinarem com o tom)
- Sem formatação markdown (negrito, links, cabeçalhos — não renderizam em DM)

VALIDAÇÃO DE CHARS:
Contar com valores médios reais:
- {{nome}} = 7 chars (ex: "Ricardo")
- {{empresa}} = 8 chars (ex: "TechFlow")
- Total substituído deve ficar ≤ 200 chars

**TIPO DE TEMPLATE (especifique):**
□ Evento específico (ex: lead de feira/congresso)
□ Cold outreach B2B
□ Follow-up pós-conexão aceita
□ Reativação de lead frio LinkedIn

**CONTEXTO DA CAMPANHA:**
- Público: [cargo/setor do destinatário]
- Oferta: [o que você quer comunicar]
- CTA: [qual ação você quer que eles tomem]
- Tom: [direto / consultivo / informal]

Gere:
1. Template principal (versão A)
2. Template alternativo (versão B — ângulo diferente)
3. Contagem de chars com {{nome}}=7 e {{empresa}}=8
4. Validação: ✓ dentro do limite ou ⚠️ reduzir

**EXEMPLO DE ESTRUTURA (template_futurecom_dm.md v3.0 — aprovado):**
```
---
tags: [futurecom, linkedin, dm, field-marketing]
char_limit: 200
version: 3.0
---
Olá! Nós cuidamos de toda a operação e experiência do cliente no stand ou no seu evento. Conheça nossa agência de eventos!

www.vrashows.com.br
```
→ 131 chars sem variáveis | versão sem {{nome}} aprovada (funciona para campo livre)
```

## Exemplo de uso

### Input
Campanha: outbound para CTOs de SaaS B2B
Oferta: VRAXIA OS — automação de operações com agentes IA
CTA: conhecer o produto
Limite: 200 chars (lista mista de 1º/2º grau)

### Output
**Template A:**
```markdown
---
tags: [saas-b2b, linkedin, dm, cto]
char_limit: 200
version: 1.0
---
Olá {{nome}}! Vi que você está na {{empresa}} — automatizamos operações de times de eng com agentes IA. Curiosidade: quanto do tempo do seu time vai para tarefas que não são produto?

vrashows.com.br/vraxia
```
Chars (nome=7, empresa=8): 183 ✓

**Template B:**
```markdown
---
tags: [saas-b2b, linkedin, dm, cto]
char_limit: 200
version: 1.1
---
Olá {{nome}}! Ajudamos CTOs de SaaS a recuperar 15h/semana de operações manuais com IA. Vale 15 min para te mostrar o caso da {{empresa}} do nosso último cliente?

vrashows.com.br
```
Chars (nome=7, empresa=8): 172 ✓

**Dry-run:**
```bash
tsx scripts/linkedin_dm_dispatcher.ts --dry-run --limit=5
```
→ Verificar que nenhum lead excede o limite com o nome real deles

---
**Tags:** Intermediário | Copywriting | Comercial, LinkedIn, Template, DM
