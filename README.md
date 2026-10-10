# Zeus — Inteligência para Redes Sociais

O Zeus é a central da Korczak Technologies para organizar contas sociais, planejar conteúdo, analisar métricas autorizadas e oferecer assistência por IA com supervisão humana.

## Infraestrutura (plano gratuito)

- **Frontend:** GitHub Pages, publicado automaticamente a partir de `frontend/`.
- **API:** Render Web Service gratuito: `https://zeus-api-cm2d.onrender.com` (health check em `/health`).
- **Banco:** MongoDB Atlas Free, projeto `Korczak Technologies`, cluster `KorczakCluster`, database `todas`.
- **IA:** serviço Ollama existente no Render (`morok-ollama.onrender.com`), acessado pelo backend para não expor endpoint/modelo ao navegador.
- **Domínio pretendido:** `https://zeus.morok.korczaktech.com.br`.

> O plano gratuito é adequado para protótipo e testes. Serviços gratuitos podem dormir, ter limites de recursos e apresentar latência. Ollama pode não caber nos recursos de memória/CPU do plano gratuito; o modelo precisa estar disponível no serviço configurado.

## Configuração do Render

Configure estas variáveis **no serviço da API**, nunca no frontend ou no Git:

- `MONGODB_URI`: URI SRV do cluster Atlas com usuário de banco e senha próprios; selecione a database `todas`.
- `MONGODB_DATABASE=todas`
- `OLLAMA_BASE_URL=https://morok-ollama.onrender.com`
- `OLLAMA_MODEL=llama3.2:1b` (ajuste para um modelo realmente instalado no Ollama).

Crie no Atlas um usuário de banco com permissões mínimas para a database `todas`, e permita o acesso de rede do Render conforme a política de segurança do projeto. Não comite credenciais. Evite liberar acesso irrestrito ao Atlas sem avaliar o risco.

## Domínio personalizado

O arquivo `frontend/CNAME` registra o domínio esperado para o build do Pages. Ainda é necessário:
1. Ativar GitHub Pages usando **GitHub Actions** como fonte de publicação.
2. Configurar no provedor DNS um registro **CNAME** para `zeus.morok` apontando a `korczaktech.github.io`.
3. Confirmar o domínio em Settings → Pages e aguardar a emissão do HTTPS.
4. Definir `MONGODB_URI` e as variáveis do Ollama no Render e verificar `/api/status`.

## API

- `GET /health` — health check para o Render.
- `GET /api/status` — estado da API, MongoDB e configuração Ollama.
- `POST /api/ai/chat` — encaminha uma mensagem ao Ollama configurado.

Exemplo de corpo para `POST /api/ai/chat`:

```json
{ "message": "Sugira um calendário editorial de 7 dias para uma marca de tecnologia." }
```

## Fases do projeto

### Fase 1 — Fundação e painel
Base de interface, API, persistência e conexões autorizadas. A autenticação, conexões reais com redes sociais, testes abrangentes e auditoria ainda precisam ser implementados antes de declarar a fase concluída.

### Fase 2 — Inteligência, conteúdo e análise
Calendário editorial, rascunhos assistidos, caixa de entrada e métricas conforme as APIs oficiais disponíveis.

### Fase 3 — Automação supervisionada
Agendamento permitido por API oficial, fila de tarefas, aprovações, permissões e auditoria.

Todas as integrações devem respeitar políticas, limites e permissões das plataformas. Sem engajamento falso, spam ou contas falsas.
