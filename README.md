# Gestão Financeira Pessoal

Aplicação web para controle financeiro individual, com foco em organização de receitas, despesas, metas e investimentos. O sistema oferece uma interface funcional para acompanhamento financeiro em tempo real, com suporte a autenticação, relatórios e persistência em nuvem.

## Visão geral

Este projeto foi desenvolvido para centralizar o controle de finanças pessoais em uma única plataforma web, permitindo:

- cadastro e monitoramento de receitas e despesas;
- gestão de categorias e contas;
- acompanhamento de saldos e evolução financeira;
- definição de metas de economia e orçamentos;
- monitoramento de investimentos;
- geração de relatórios mensais e anuais;
- acesso por autenticação segura do usuário.

## Principais funcionalidades

### Autenticação e acesso

- login com e-mail e senha;
- criação de conta para novos usuários;
- login com provedor Google;
- redirecionamento automático para o painel principal após autenticação.

### Dashboard financeiro

- visão consolidada de saldo, entradas e saídas;
- projeção financeira do período atual;
- gráficos comparativos mensais;
- indicadores de contas pendentes e alertas;
- modo de privacidade para ocultar valores sensíveis em tela.

### Gestão de transações

- registro de recebimentos e pagamentos;
- filtros por período, categoria, tipo e status;
- busca por descrição;
- controle de transações pendentes e pagas;
- exclusão em massa de registros selecionados.

### Orçamentos e metas

- definição de limites por categoria;
- acompanhamento do percentual utilizado;
- criação de metas de economia com progresso visual;
- registro de contribuições direcionadas a metas específicas.

### Investimentos

- cadastro de ativos e classes de investimento;
- controle de quantidade, preço médio e valor atual;
- cálculo de resultado financeiro por ativo;
- resumo do patrimônio total do usuário.

### Relatórios

- visão geral anual de receitas e despesas;
- resumos por categoria e evolução temporal;
- exportação de dados em formato PDF para documentação e análise.

## Stack tecnológica

- HTML5
- CSS3
- JavaScript vanilla
- Firebase Authentication
- Cloud Firestore
- Chart.js
- jsPDF
- PWA / Service Worker
- Capacitor Android com notificações locais e push remoto
- OneSignal para distribuição de notificações push

## Estrutura do projeto

```text
.
├── public/
│   ├── index.html              # painel principal da aplicação
│   ├── login.html              # tela de autenticação
│   ├── manifest.json           # configuração PWA
│   ├── sw.js                   # cache offline e service worker
│   ├── css/
│   │   └── style.css           # estilos visuais da interface
│   ├── js/
│   │   ├── firebase-init.js    # inicialização do cliente Firebase
│   │   └── script.js           # regras de negócio, UI e integrações
│   └── icons/                  # ativos visuais do aplicativo
├── firebase.json               # configuração do Firebase Hosting
├── firestore.indexes.json      # índices do Firestore
├── .firebaserc                 # aliases de ambiente do Firebase
├── README.md                   # documentação do projeto
└── .gitignore
```

## Requisitos

- navegador moderno com suporte a JavaScript;
- conta no Firebase para provisionamento do backend e autenticação;
- acesso ao projeto com as credenciais de desenvolvimento configuradas localmente.

## Executando localmente

Como o projeto é uma aplicação estática, a execução local pode ser feita por meio de um servidor HTTP simples.

### Opção 1: servidor Python

```bash
cd public
python -m http.server 8000
```

Em seguida, acesse:

```text
http://localhost:8000/login.html
```

### Opção 2: Firebase Hosting local

```bash
firebase login
firebase serve --only hosting
```

## Implantação

A implantação em ambiente de produção pode ser feita com Firebase Hosting:

```bash
firebase login
firebase use <seu-ambiente>
firebase deploy --only hosting
```

## Aplicativo Android

O aplicativo Android usa Capacitor como uma casca nativa para o site publicado no Firebase Hosting. O Firebase continua sendo a fonte de dados, portanto alterações publicadas no site ficam disponíveis no app sem duplicar a aplicação.

### Requisitos

- Node.js 18 ou superior;
- Android Studio;
- Android SDK configurado;
- Java 21 (JDK);
- endereço de produção configurado em `capacitor.config.json`.

### Preparar o projeto Android

```bash
npm install
npm run android:add
npm run android:sync
npm run android:open
```

No Android Studio, execute o projeto em um dispositivo ou emulador. Para gerar um APK de debug:

```bash
cd android
./gradlew assembleDebug
```

As notificações nativas usam o plugin `@capacitor/local-notifications`. No primeiro uso, o app solicita a permissão do Android para enviar notificações.

O login com Google usa autenticação nativa somente no Android e mantém `signInWithPopup` no navegador. Para habilitar o login nativo em um dispositivo, é necessário ativar o provedor Google no Firebase, cadastrar o SHA-1 do certificado Android e adicionar o `google-services.json` correspondente ao projeto em `android/app/`.

### Notificações push com OneSignal

O aplicativo também pode registrar dispositivos Android no OneSignal. O identificador do usuário autenticado no Firebase é associado ao dispositivo como identificador externo, permitindo enviar mensagens para um usuário específico ou para todos os usuários inscritos.

Para habilitar o envio Android no OneSignal:

1. Crie ou acesse um aplicativo no painel do OneSignal.
2. Configure o provedor Google Android (FCM) usando o JSON da conta de serviço do Firebase.
3. Instale o APK com o plugin OneSignal incluído.
4. Abra o app, autentique um usuário e aceite a permissão de notificações.
5. Confirme no painel do OneSignal que o dispositivo aparece como inscrito em Google Android (FCM).
6. Envie uma mensagem de teste pelo painel antes de criar campanhas para todos os usuários.

O JSON da conta de serviço do Firebase é uma credencial administrativa e não deve ser enviado pelo chat, versionado no Git ou incluído no APK. Ele é diferente do `google-services.json` usado pelo aplicativo Android.

Para gerar e instalar uma versão de debug:

```powershell
cd android
.\gradlew.bat assembleDebug
adb install app\build\outputs\apk\debug\app-debug.apk
```

O envio remoto só alcança dispositivos que instalaram uma versão com OneSignal, abriram o aplicativo e concederam a permissão de notificações. As notificações locais de contas a pagar continuam sendo agendadas no próprio dispositivo e não dependem do OneSignal.

### Lembretes automáticos de contas a vencer

Os lembretes funcionam nos dois modos:

- **Local:** o app agenda notificações no dispositivo para 7, 5 e 3 dias antes e no dia do vencimento, às 09:00;
- **Remoto:** a Cloud Function `sendDueDateReminders` executa diariamente às 09:00 no horário de Brasília, consulta despesas pendentes no Firestore e envia uma notificação OneSignal ao `user.uid` correspondente.

A chave REST privada do OneSignal é usada somente como segredo do Firebase. Ela não deve ser colocada no frontend, em `public/` ou no repositório.

Mensagens usadas nos lembretes:

- 7 dias antes: `Sua conta vence em 7 dias. Já conferiu? 👀`
- 5 dias antes: `Faltam 5 dias para sua conta vencer. Não deixe para depois!`
- 3 dias antes: `Sua conta vence em 3 dias. Se organize para evitar atrasos.`
- No dia: `Tá esquecendo de pagar nada não? 👀`

Para configurar o envio remoto:

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set ONESIGNAL_REST_API_KEY
firebase deploy --only functions:sendDueDateReminders
```

O segredo deve ser a chave REST privada do aplicativo no OneSignal, não o App ID público. A função registra cada lembrete enviado no documento da transação para evitar duplicidade. Quando uma conta é marcada como paga, ela deixa de atender ao filtro remoto e os lembretes locais são reagendados pelo aplicativo.

## Configuração de ambiente

Antes da execução, o projeto deve receber as configurações do cliente Firebase do ambiente desejado. A configuração deve ser mantida em um arquivo de inicialização do SDK e não deve ser versionada com segredos ou credenciais sensíveis.

## Segurança e boas práticas

- manter credenciais de infraestrutura fora do controle de versão;
- usar regras de autorização adequadas no Firestore e Authentication;
- evitar armazenamento de dados sensíveis em texto simples no frontend;
- validar entradas do usuário antes de persistir informações;
- configurar limites e auditoria para dados financeiros e registros de acesso.

## Observações de arquitetura

A aplicação foi implementada como uma SPA front-end, com persistência em base de dados em nuvem e autenticação gerenciada por serviços externos. O código está organizado em arquivos estáticos, com a lógica principal centralizada no JavaScript da interface e a comunicação com o backend em serviços do Firebase.

## Licença

Este projeto é destinado ao uso interno ou educacional conforme a necessidade do responsável pela implementação. Sinta-se livre para adaptar, estender ou reutilizar a estrutura para outros contextos financeiros.
