# Dados de imprensa LinkedIn

Arquivo principal:

- `contatos_validados.json`

Observacoes:

- Batch limitado a 25 contatos, conforme regras do runtime.
- Emails pessoais inferidos por padrao de dominio nao foram marcados como validados.
- `email_validado` foi preenchido apenas quando havia email publico fornecido na solicitacao ou encontrado como contato institucional.
- Registros sem email publico ficam com `status: "pendente"`.
- Correio Braziliense ficou fora deste batch por ser item bonus e exceder o limite de 25 leads.
