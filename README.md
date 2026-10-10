# Zeus — Central de Inteligência Korczak

O Zeus está evoluindo de um painel de redes sociais para uma central de inteligência e automação do ecossistema digital: Google, Microsoft, produtos Korczak Technologies e outros serviços com APIs oficiais. A interface usa uma identidade própria, com estética tecnológica inspirada em uma central de comando e referências visuais à mitologia de Zeus.

## Estado atual

- **Interface:** painel de comando, navegação por áreas, catálogo de integrações, tarefas locais de sessão, configurações e histórico temporário.
- **Assistente:** API encaminha mensagens ao Ollama no backend.
- **Voz:** ditado pelo reconhecimento de fala do navegador; endpoint neural de texto para fala implementado no backend, usando uma única voz fixa `pt-BR-AntonioNeural`.
- **Publicação web:** GitHub Pages via GitHub Actions.
- **API:** Render Web Service `https://zeus-api-cm2d.onrender.com` (health check em `/health`).
- **Banco:** MongoDB Atlas, database `todas`.
- **Domínio:** `https://zeus.morok.korczaktech.com.br`.

**Importante:** a interface e as rotas iniciais não significam que contas Google, Microsoft ou Korczak já estejam conectadas. Conectores externos só devem ser exibidos como ativos depois de autenticação, teste e autorização reais. Tarefas e histórico na interface ainda são temporários até a fundação de persistência e autenticação estar concluída.

## Configuração da API no Render

Configure as variáveis diretamente no serviço do Render. Nunca coloque chaves ou credenciais no frontend, no README ou no Git.

Obrigatórias para os serviços existentes:
- `MONGODB_URI`: URI SRV do cluster Atlas.
- `MONGODB_DATABASE=todas`
- `OLLAMA_BASE_URL=https://morok-ollama.onrender.com`
- `OLLAMA_MODEL=llama3.2:1b` (ou o nome exato de um modelo instalado no serviço Ollama).

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
- `GET /api/status` — estado de API, MongoDB, Ollama e configuração de voz neural.
- `POST /api/ai/chat` — conversa com o modelo Ollama configurado.
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
- Google Workspace APIs e Microsoft Graph conforme escopos concedidos.
- Acesso mínimo necessário a e-mail, arquivos, documentos, planilhas, calendário, contatos e tarefas.
- Armazenamento criptografado de tokens e testes de reconexão/expiração.

### Fase 3 — Ecossistema Korczak Technologies
- Contratos de API e autenticação entre Zeus, Korczak HUB, Nexus, Nexa, KOS e Morok AI.
- Catálogo de recursos realmente disponíveis em cada serviço.
- Identidade compartilhada apenas onde houver suporte real.
- Permissões por produto, testes de integração e revogação.

### Fase 4 — Inteligência central e orquestração
- Planejador de tarefas com etapas, ferramentas e dependências.
- Recuperação de dados autorizados e síntese de resultados com referências às fontes.
- Prévia da ação, confirmação de operações sensíveis e verificação pós-execução.
- Respostas em texto e voz, sem alegar ações que não ocorreram.

### Fase 5 — Automações confiáveis
- Agendamentos, fila de tarefas, tentativas com limites e tratamento de falhas.
- Aprovação humana, notificações e histórico de execução.
- Proteção contra duplicação, cancelamento e pausas globais.
- Testes de execução e recuperação.

### Fase 6 — Agente local para computador
- Aplicativo/serviço desktop separado da versão web.
- Pareamento seguro e permissões explícitas por capacidade.
- Acesso local a arquivos, pastas e aplicativos apenas conforme autorizado.
- Lista de ações permitidas, confirmação para operações destrutivas e auditoria local.
- Testes em cada sistema operacional suportado; o navegador, sozinho, não pode obter acesso irrestrito ao computador.

## Critério de conclusão

Uma fase só será marcada como concluída depois de revisar o código, executar os testes disponíveis, validar os fluxos de erro e registrar dependências externas restantes. Credenciais privadas não devem ser pedidas no chat nem comitadas no repositório: devem ser configuradas diretamente no painel seguro do provedor.
