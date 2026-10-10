# Zeus — Central de Inteligência Korczak

O Zeus está evoluindo de um painel de redes sociais para uma central de inteligência e automação do ecossistema digital: Google, Microsoft, produtos Korczak Technologies e outros serviços com APIs oficiais. A interface usa uma identidade própria, com estética tecnológica inspirada em uma central de comando e referências visuais à mitologia de Zeus.

## Estado atual do código

- **Interface:** central de comando com identidade visual Zeus, login, perfil, configurações, explorador de conectores, tarefas, automações e área do agente local.
- **Contas e dados:** endpoints de autenticação, sessões, tarefas, preferências, mensagens, auditoria, notificações e automações persistidas no MongoDB.
- **Orquestração:** plano inicial de consultas somente leitura pode combinar serviços conectados e enviar os resultados ao modelo para síntese.
- **Google/Microsoft:** fluxo OAuth com PKCE, armazenamento de tokens com AES-256-GCM, renovação de tokens e adaptadores de leitura implementados; faltam credenciais OAuth reais e testes com contas autorizadas.
- **Korczak:** adaptadores iniciais para Nexus, Nexa e Morok AI; exigem vincular cada conta, e não há SSO compartilhado.
- **Voz:** endpoint neural de texto para fala com voz fixa `pt-BR-AntonioNeural`; faltam as credenciais do Azure Speech para ativação. O navegador serve como fallback.
- **Agente local:** código opcional em `desktop-agent/` para ler/listar arquivos em pastas explicitamente permitidas; precisa ser instalado e testado no computador do usuário. Guia de instalação: [desktop-agent/README.md](desktop-agent/README.md).
- **Automações:** notificações e resumos programados com histórico; o scheduler roda dentro da API e pode atrasar quando o serviço Render dorme.
- **Publicação web:** GitHub Pages via GitHub Actions.
- **API:** Render Web Service `https://zeus-api-cm2d.onrender.com` (health check em `/health`).
- **Banco:** MongoDB Atlas, database `todas`.
- **Domínio:** `https://zeus.morok.korczaktech.com.br`.

**Importante:** código implementado não equivale a integração validada. Google/Microsoft ainda precisam de client IDs e secrets; Nexus/Nexa/Morok precisam ser vinculados com suas contas; a voz neural precisa das credenciais Azure. A fase só será marcada como concluída depois de testes reais de ponta a ponta e revisão de segurança.

## Configuração da API no Render

Configure as variáveis diretamente no serviço do Render. Nunca coloque chaves ou credenciais no frontend, no README ou no Git.

Obrigatórias para os serviços existentes:
- `MONGODB_URI`: URI SRV do cluster Atlas.
- `MONGODB_DATABASE=todas`
- `OLLAMA_BASE_URL=https://morok-ollama.onrender.com`
- `OLLAMA_MODEL=llama3.2:1b` (ou o nome exato de um modelo instalado no serviço Ollama).
- `ZEUS_AUTH_SECRET`: segredo aleatório exclusivo do Zeus, com pelo menos 32 caracteres, para assinar sessões. Gere um segredo novo e configure-o diretamente no Render.
- `ZEUS_SIGNUP_ENABLED=true`: permite cadastro de novas contas; defina `false` para bloquear novos cadastros depois de preparar o acesso desejado.

### Preparar OAuth do Google e Microsoft

A API já contém o fluxo de autorização OAuth com `state`, PKCE e armazenamento criptografado dos tokens. Para habilitar os botões, crie os aplicativos nos consoles oficiais e configure diretamente no Render:

**Google Cloud Console**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://zeus-api-cm2d.onrender.com/api/connectors/google/callback`

**Microsoft Entra admin center**
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID=common` (ou o tenant adequado)
- `MICROSOFT_REDIRECT_URI=https://zeus-api-cm2d.onrender.com/api/connectors/microsoft/callback`

**Proteção dos tokens**
- `ZEUS_CONNECTOR_ENCRYPTION_KEY`: chave aleatória de 32 bytes, representada por 64 caracteres hexadecimais. Ela já foi configurada no serviço Render; mantenha-a privada e não a regenere após armazenar conexões, ou os tokens antigos não poderão ser descriptografados.
- Registre os URIs de callback exatamente como acima nos consoles de cada provedor.
- Revise a tela de consentimento, usuários de teste e exigências de verificação de cada plataforma. Algumas permissões podem exigir aprovação do administrador ou verificação do aplicativo.
- Os escopos iniciais são de leitura, com acesso mínimo compatível com as consultas implementadas. O fluxo OAuth, renovação de tokens e adaptadores de leitura estão no código; ainda dependem de credenciais reais e testes de ponta a ponta. Operações de escrita (enviar e-mail, alterar arquivos, criar eventos etc.) exigirão escopos adicionais e confirmação explícita antes da execução.

### Ativar voz neural do Zeus

A API já inclui `POST /api/voice/tts`, com limite de texto, proteção básica contra excesso de solicitações e credenciais mantidas no backend. Para ativar a voz neural, crie um recurso **Azure Speech** e configure no Render:

- `SPEECH_KEY`: chave do recurso Azure Speech.
- `SPEECH_REGION`: região do recurso, por exemplo a região indicada no portal Azure.

A voz é fixa: `pt-BR-AntonioNeural`, masculina em português brasileiro. O SSML ajusta levemente a velocidade e o tom para uma entrega mais serena e firme. A lista de vozes e o endpoint seguem a documentação oficial da [API REST de texto para fala do Azure Speech](https://learn.microsoft.com/pt-br/azure/ai-services/speech-service/rest-text-to-speech) e da [lista de idiomas e vozes](https://learn.microsoft.com/pt-br/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment).

Sem as variáveis de Azure, a interface recorre à voz local do navegador. A voz neural depende de uma chave de serviço válida, conectividade e cobrança/limites do Azure. Nunca exponha `SPEECH_KEY` no frontend.

### Rede e segurança do Atlas

Use um usuário de banco com permissões mínimas para a database `todas`. Restrinja a lista de acesso de rede conforme a infraestrutura e a política de segurança. Evite liberar acesso irrestrito ao Atlas sem avaliar o risco.

## Rotas atuais da API

- `GET /` — identidade e versão da API.
- `GET /health` — health check.
- `GET /api/status` — estado de API, MongoDB, Ollama, autenticação e voz neural.
- `GET /api/auth/config` — informa se autenticação e cadastro estão configurados.
- `POST /api/auth/register` / `POST /api/auth/login` — criar conta e iniciar sessão.
- `GET /api/auth/me` / `POST /api/auth/logout` — validar e encerrar a sessão.
- `GET /api/me/tasks`, `POST /api/me/tasks`, `PATCH /api/me/tasks/:id`, `DELETE /api/me/tasks/:id` — tarefas isoladas por conta.
- `GET /api/me/preferences`, `PATCH /api/me/preferences` — preferências de voz e segurança persistidas.
- `GET /api/me/connectors` — catálogo e estado de configuração dos conectores.
- `POST /api/connectors/google/start`, `POST /api/connectors/microsoft/start` — iniciar autorização OAuth com PKCE.
- `POST /api/connectors/korczak/:product/connect` — vincular uma sessão de Nexus, Nexa ou Morok; a senha não é armazenada.
- `GET /api/me/connectors/:provider/resources/:resource` — consultas de leitura permitidas para Google, Microsoft, Nexus e Nexa.
- `GET /api/connectors/:provider/callback` — concluir o fluxo OAuth e guardar tokens criptografados.
- `POST /api/me/connectors/:provider/disconnect` — remover a conexão local e tentar revogar o token Google.
- `GET /api/me/messages?conversationId=...` — histórico de conversa por conta.
- `GET /api/me/activity` — consultar a auditoria autenticada.
- `GET /api/me/automations`, `POST /api/me/automations`, `PATCH /api/me/automations/:id`, `DELETE /api/me/automations/:id` — automações internas seguras.
- `GET /api/me/automation-runs`, `GET /api/me/notifications`, `PATCH /api/me/notifications/:id/read` — histórico e notificações.
- `GET /api/me/action-requests`, `POST /api/me/action-requests/:id/confirm`, `POST /api/me/action-requests/:id/cancel` — ações pendentes, confirmação explícita e cancelamento.
- `POST /api/ai/chat` — conversa com o modelo Ollama; mantém contexto recente para usuários autenticados e exige sessão depois que `ZEUS_AUTH_SECRET` estiver configurado.
- `POST /api/voice/tts` — retorna áudio MP3 gerado pela voz neural fixa quando o serviço está configurado.

Exemplo de mensagem para o assistente:

```json
{ "message": "Organize minhas prioridades para hoje." }
```

Exemplo de solicitação de voz:

```json
{ "text": "Zeus em prontidão. Como posso ajudar?" }
```

## Plano de conclusão — seis fases

A ordem é intencional. Cada fase deve ser implementada, testada e corrigida antes de ser considerada concluída. As integrações dependem de credenciais, permissões e APIs oficiais válidas; a ausência dessas credenciais não deve ser disfarçada como sucesso.

### Fase 1 — Fundação, identidade e segurança
- Autenticação e sessões seguras.
- Perfis, permissões granulares e consentimento.
- Persistência no MongoDB para preferências, tarefas, memória e histórico.
- Auditoria de ações e erros.
- Registro comum de conectores, estado de conexão e revogação.
- Testes automatizados e validação de segurança.

### Fase 2 — Google e Microsoft
- OAuth oficial, estado/PKCE quando aplicável, callback e revogação.
- Google Workspace APIs e Microsoft Graph em leitura inicial, conforme escopos concedidos.
- Escopos de escrita incrementais somente quando as ações correspondentes forem implementadas e protegidas por confirmação.
- Acesso mínimo necessário a e-mail, arquivos, documentos, planilhas, calendário, contatos e tarefas.
- Armazenamento criptografado de tokens e testes de reconexão/expiração.

### Fase 3 — Ecossistema Korczak Technologies
- Catálogo de conectores e autenticação de sessão do Nexus, Nexa e Morok AI via APIs existentes.
- Tokens dos produtos armazenados criptografados no backend; senhas não são persistidas.
- Leitura inicial de documentos/pastas do Nexus, planilhas/modelos do Nexa e memórias/tarefas/arquivos/calendário do Morok.
- Nexus, Nexa e Morok ainda exigem vinculação separada porque os backends não oferecem SSO/OIDC comum.
- HUB e KOS continuam pendentes de contratos de API estáveis e autenticação suportada.

### Fase 4 — Inteligência central e orquestração
- Planejador inicial de consultas somente leitura entre Google, Microsoft, Nexus, Nexa e Morok.
- Encadeamento inicial de busca no Drive para leitura de documento/planilha quando houver correspondência.
- Confirmação explícita para criar tarefas, salvar memórias e criar notificações no Morok.
- Ações Google/Microsoft de escrita e planos com dependências complexas ainda precisam ser implementados e testados.
- Respostas em texto e voz, sem alegar ações que não ocorreram.

### Fase 5 — Automações confiáveis
- Agendamentos por data única ou intervalo, notificações internas e resumos do assistente.
- Histórico de execução, estado ativo/pausado e notificações por conta.
- O scheduler usa o processo da API; precisa de um worker sempre ativo para garantir execução 24/7, retries avançados e recuperação robusta.
- Automações cross-service com ações de escrita ainda não estão concluídas.

### Fase 6 — Agente local para computador
- Aplicativo/serviço desktop separado da versão web.
- Pareamento seguro e permissões explícitas por capacidade.
- Acesso local a arquivos, pastas e aplicativos apenas conforme autorizado.
- Lista de ações permitidas, confirmação para operações destrutivas e auditoria local.
- Testes em cada sistema operacional suportado; o navegador, sozinho, não pode obter acesso irrestrito ao computador.

## Critério de conclusão

Uma fase só será marcada como concluída depois de revisar o código, executar os testes disponíveis, validar os fluxos de erro e registrar dependências externas restantes. Credenciais privadas não devem ser pedidas no chat nem comitadas no repositório: devem ser configuradas diretamente no painel seguro do provedor.
