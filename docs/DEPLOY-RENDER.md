# Publicando o Escala Solidária no Render (grátis) com Turso

Este guia coloca o sistema no ar com **custo zero**:

- **Render** (plano Free) roda o app Node.js e dá um endereço `https://…onrender.com`.
- **Turso** (plano Free) guarda o banco: é **SQLite na nuvem**, com o mesmo SQL que o projeto já usa.

> **Por que não usar só o arquivo `data/escala.db` no Render?**
> No plano gratuito, o disco do Render é apagado a cada atualização, reinício ou quando o app "dorme".
> Todas as inscrições, doações e recibos sumiriam. Com o Turso, o banco fica fora do Render e não se perde.
>
> No seu computador nada muda: sem as variáveis do Turso, o app continua usando o arquivo `data/escala.db`.

Tempo estimado: 20 a 30 minutos.

---

## Passo 1 — Colocar o código no GitHub

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. Crie um repositório novo, por exemplo `escala-solidaria` (pode ser **privado**).
3. Envie o projeto. No terminal, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Escala Solidária"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/escala-solidaria.git
git push -u origin main
```

O `.gitignore` já impede que `node_modules/` e o banco local (`data/`) subam para o GitHub.

---

## Passo 2 — Criar o banco no Turso

1. Acesse <https://turso.tech> e crie uma conta (dá para entrar com o GitHub).
2. Crie um banco de dados, por exemplo `escala-solidaria`. Se puder escolher a região, use uma dos **EUA (leste)**,
   perto da região do Render usada no `render.yaml` (`virginia`).
3. Na página do banco, copie:
   - a **URL** do banco, que começa com `libsql://`;
   - um **token** de acesso (opção de gerar/criar token).

Guarde os dois: eles vão no Passo 3. **O token é uma senha: não coloque no código nem no GitHub.**

> Plano gratuito do Turso: 5 GB de armazenamento, 500 milhões de linhas lidas e 10 milhões escritas por mês,
> e o banco não "dorme" quando fica parado. É muito mais do que uma ONG precisa.

---

## Passo 3 — Criar o serviço no Render

1. Acesse <https://render.com> e crie uma conta com o GitHub.
2. Clique em **New → Blueprint** e escolha o repositório `escala-solidaria`.
   O Render lê o arquivo `render.yaml` e já preenche tudo: comando de build, de início, health check e fuso horário.
3. Ele vai pedir as duas variáveis que ficaram em branco:

| Variável | Valor |
|---|---|
| `TURSO_DATABASE_URL` | a URL `libsql://…` do Passo 2 |
| `TURSO_AUTH_TOKEN` | o token do Passo 2 |

4. Clique em **Apply / Deploy** e espere o build terminar (2 a 5 minutos).
5. Abra o endereço `https://escala-solidaria-xxxx.onrender.com`.

Nos logs do Render deve aparecer:

```
Banco: Turso (SQLite na nuvem)
Banco vazio: dados de demonstração criados (...)
Escala Solidária rodando na porta 10000
```

**Sem Blueprint?** Dá para criar em **New → Web Service** com estes campos: Runtime `Node`, Build Command
`npm ci --omit=dev`, Start Command `npm start`, Instance Type `Free`, Health Check Path `/api/health`, e as
variáveis `NODE_ENV=production`, `TZ=America/Sao_Paulo`, `SESSION_SECRET` (um texto longo qualquer),
`SEED_DEMO=true`, `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`.

---

## Passo 4 — Demonstração × uso real pela ONG

Com `SEED_DEMO=true`, o primeiro acesso cria a creche fictícia Girassol Azul e os usuários de teste
(`ong@demo.com` e `voluntario@demo.com`, senha `123456`). Ótimo para **apresentar na faculdade**.

**Antes de a ONG real usar**, não deixe essas contas de teste no ar (a senha é pública):

1. No Turso, apague e recrie o banco (ou crie outro banco novo e troque a URL e o token no Render).
2. No Render, em **Environment**, mude `SEED_DEMO` para `false` e salve (o app reinicia).
3. Abra o sistema, escolha **Sou ONG → Criar conta** e cadastre a ONG real.
4. Em **Perfil, PIX e WhatsApp**, cadastre a chave PIX verdadeira e o WhatsApp, e teste com um PIX de R$ 1,00.

---

## Passo 5 (opcional) — "Despertador" para o app não dormir

No plano Free, o Render desliga o app depois de **15 minutos sem acesso**; o próximo acesso leva cerca de
**1 minuto** para carregar. Os dados **não** se perdem (estão no Turso), é só a espera.

Para evitar a espera, um serviço externo pode acessar o app a cada poucos minutos:

1. Crie uma conta grátis no **UptimeRobot** (<https://uptimerobot.com>) ou no **cron-job.org**.
2. Crie um monitor do tipo **HTTP(s)** com a URL `https://SEU-APP.onrender.com/api/health`.
3. Intervalo: **5 a 10 minutos**.

| | |
|---|---|
| **Prós** | Sem espera no primeiro acesso; lembretes automáticos rodam o tempo todo; custo zero. |
| **Contras** | O Render dá **750 horas grátis por mês** por conta: um app ligado o mês inteiro usa de 720 a 744 h, então sobra pouco para outro serviço grátis na mesma conta. Quando as horas acabam, o serviço fica suspenso até o mês seguinte. O "dormir" é proposital no plano Free e as regras podem mudar. |

O endereço `/api/health` **não consulta o banco**, então o despertador não gasta a cota do Turso.

---

## Atualizando o sistema

Faça as mudanças no computador, rode `npm test` e envie:

```bash
git add .
git commit -m "descrição da mudança"
git push
```

O Render publica sozinho em poucos minutos. **O banco no Turso não é apagado** nas atualizações.

---

## Limitações do plano gratuito

- **Sessões em memória:** quando o app reinicia ou dorme, as pessoas precisam entrar de novo (os dados ficam).
- **Lembretes de 24h:** o verificador roda a cada 10 minutos, só enquanto o app está acordado
  (o despertador resolve). O envio continua simulado: grava no banco e aparece nos logs.
- **Render Free:** 750 horas/mês por conta; o app pode ficar mais lento em horários de pico.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Log "Não foi possível iniciar" com erro de autenticação | Token do Turso errado ou expirado | Gere outro token no Turso e atualize `TURSO_AUTH_TOKEN` |
| Log "Banco: SQLite local" no Render | `TURSO_DATABASE_URL` vazia | Preencha a variável e faça **Manual Deploy** |
| Login não "segura" (volta para a tela de entrar) | Acesso por `http://` em vez de `https://` | Use sempre o endereço `https://…onrender.com` |
| Horários errados (turnos "já passaram") | Falta a variável `TZ` | Defina `TZ=America/Sao_Paulo` |
| Primeiro acesso demora ~1 minuto | App estava dormindo | Normal no plano Free; veja o Passo 5 |

## Testar o modo Turso no computador (opcional)

O mesmo cliente do Turso funciona com um arquivo local, sem conta:

```bash
TEST_DB=file:./teste-turso.db npm test
```

No Windows (PowerShell): `$env:TEST_DB='file:./teste-turso.db'; npm test`.

Ou rode o app apontando para o banco do Turso de verdade:

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm start
```

Para recriar os dados de demonstração **no Turso** (apaga tudo antes):
`TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run seed`.
