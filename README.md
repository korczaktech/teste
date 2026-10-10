# Zeus — Inteligência para Redes Sociais

**Zeus** é o projeto de um assistente inteligente para administrar, analisar e otimizar a presença digital em redes sociais a partir de um único painel. O objetivo é reunir monitoramento, planejamento de conteúdo, análise de desempenho e apoio à comunidade, com controle humano sobre publicações e ações sensíveis.

> **Escopo:** o Zeus deve operar por meio de APIs oficiais e permissões autorizadas. Não deve criar engajamento falso, contas falsas, spam, nem contornar limites ou controles das plataformas.

## Visão do produto

- **Painel unificado:** acompanhar contas, publicações, comentários e métricas disponíveis.
- **Inteligência de conteúdo:** sugerir ideias, rascunhos, calendários e adaptações por plataforma.
- **Monitoramento:** identificar tendências, menções, alterações de desempenho e possíveis crises.
- **Assistência à comunidade:** classificar comentários e preparar respostas para revisão humana.
- **Relatórios:** transformar dados autorizados em indicadores, resumos e recomendações.
- **Segurança:** separar permissões por conta, proteger credenciais e registrar ações executadas.

## Fase 1 — Fundação e painel de controle

**Objetivo:** criar uma base confiável e uma interface utilizável, sem automatizações arriscadas.

### Entregas
- Definir arquitetura, tecnologias, estrutura do projeto e padrões de segurança.
- Criar interface responsiva com painel inicial, navegação e identidade visual do Zeus.
- Implementar autenticação, sessões e perfis de usuário.
- Criar cadastro de redes/contas conectadas, com estado de conexão e permissões visíveis.
- Construir armazenamento para contas, publicações, métricas e histórico de atividades.
- Preparar integração por APIs oficiais, começando por uma plataforma com acesso autorizado.
- Criar dados demonstrativos claramente identificados para testar a interface sem credenciais reais.
- Adicionar logs, tratamento de erros, testes básicos e documentação de configuração.

### Critérios de conclusão
- O usuário consegue entrar, navegar e consultar o painel sem erros.
- Tokens e segredos não aparecem no frontend, nos logs ou no repositório.
- Contas de demonstração são separadas de contas reais.
- A integração informa claramente quando uma permissão ou API não está disponível.

## Fase 2 — Inteligência, conteúdo e análise

**Objetivo:** transformar o painel em uma central de planejamento e compreensão das redes.

### Entregas
- Calendário editorial com rascunhos, categorias, campanhas e status.
- Assistente de IA para sugerir ideias, títulos, legendas e variações de conteúdo.
- Adaptar textos a cada plataforma, respeitando limites e formatos.
- Caixa de entrada unificada para comentários e mensagens que as APIs autorizadas permitirem acessar.
- Classificação assistida de comentários por tema, sentimento, urgência e possível spam.
- Sugestões de respostas com aprovação humana antes do envio.
- Métricas e gráficos de alcance, interações, crescimento e desempenho, conforme os dados fornecidos pelas plataformas.
- Relatórios por período e alertas configuráveis para variações relevantes.
- Busca e filtros por conta, campanha, conteúdo e intervalo de datas.

### Critérios de conclusão
- Métricas exibidas correspondem aos dados recebidos e indicam sua origem e período.
- Conteúdos gerados pela IA permanecem como rascunhos até a aprovação do usuário.
- O sistema distingue dados reais, estimativas e exemplos.
- Falhas de API não são apresentadas como resultados válidos.

## Fase 3 — Automação supervisionada e operação avançada

**Objetivo:** automatizar tarefas repetitivas com limites explícitos, rastreabilidade e supervisão.

### Entregas
- Agendamento e publicação quando a API oficial da plataforma permitir.
- Fila de tarefas com tentativas controladas, idempotência e tratamento de falhas.
- Regras configuráveis para alertas, triagem e rotinas recorrentes.
- Aprovação por usuário ou equipe antes de publicar, responder ou executar ações sensíveis.
- Monitor de tarefas, histórico de execuções e opção de pausar ou cancelar automações.
- Gestão de equipes, papéis e permissões por conta.
- Limites de frequência e respeito aos limites de uso de cada API.
- Auditoria de ações: quem autorizou, o que foi executado, quando e com qual resultado.
- Testes de segurança, recuperação de falhas, backups e documentação de implantação.

### Critérios de conclusão
- Nenhuma automação publica ou envia mensagens sem permissão válida e configuração explícita.
- O usuário consegue pausar rotinas e revogar conexões.
- Erros e ações ficam registrados sem expor tokens ou dados secretos.
- O sistema respeita políticas das plataformas, consentimento e legislação aplicável.

## Requisitos transversais

- **Privacidade:** coletar apenas os dados necessários, limitar retenção e permitir exclusão quando aplicável.
- **Segurança:** armazenar credenciais no backend em mecanismo apropriado de segredos; nunca versionar chaves.
- **Confiabilidade:** validar entradas, lidar com limites de API, usar filas quando necessário e monitorar falhas.
- **Transparência:** identificar conteúdo sugerido por IA e manter histórico das ações automatizadas.
- **Acessibilidade:** interface responsiva, navegação por teclado e estados de erro compreensíveis.
- **Qualidade:** testes automatizados, revisão de código e critérios de aceite para cada entrega.

## Fora do escopo

- Comprar ou fabricar seguidores, curtidas, comentários ou visualizações.
- Criar contas falsas, coordenar engajamento inautêntico ou enviar spam.
- Burlar autenticação, limites, proteções ou regras das plataformas.
- Publicar conteúdo sensível ou responder em nome do usuário sem autorização adequada.

## Regra de execução do projeto

As fases devem ser realizadas **uma de cada vez**. Para cada fase: implementar os itens, executar testes, revisar os resultados, corrigir os defeitos encontrados e verificar os critérios de conclusão. Só então iniciar a fase seguinte. Uma fase não deve ser declarada concluída apenas porque a interface foi criada.

## Estado atual

- [ ] Fase 1 — Fundação e painel de controle
- [ ] Fase 2 — Inteligência, conteúdo e análise
- [ ] Fase 3 — Automação supervisionada e operação avançada

**Status:** planejamento inicial. Nenhuma fase é considerada implementada até que seus critérios de conclusão sejam verificados.
