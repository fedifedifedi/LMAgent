@AGENTS.md

# Projet : LMAgent
App Next.js multi-utilisateur qui génère une lettre de motivation personnalisée par offre d'emploi, avec aperçu et export PDF designé.
Chaque utilisateur importe son CV (PDF, image ou texte), le LLM l'extrait vers le schéma Zod du profil, l'utilisateur vérifie/corrige
dans un formulaire, puis le profil est enregistré en base. Il choisit ensuite un profil validé, colle une offre (texte ou lien),
et l'agent produit une lettre spécifique à cette offre. Pas d'authentification pour l'instant.

## Feuille de route
Faites : 1. Fondations · 2. Schéma du profil · 3. Base (Prisma + libSQL, FTS5) · 4. Couche LLM · 5. Import du CV (PDF texte ou texte collé).

À faire, dans cet ordre (proposer le plan détaillé avant chaque étape) :
- **5b. CV en image et lecture native** : JPG, PNG, WebP envoyés directement au LLM (lecture native), de même que les PDF scannés
  (automatique quand le PDF n'a pas de texte) et, en option, les PDF texte (mise en page en colonnes). Images redimensionnées
  dans le navigateur avec canvas avant l'envoi (pas de sharp : module natif). HEIC : message demandant de convertir en JPG.
  Aperçu de l'image avant l'analyse. Le prompt demande d'omettre ce qui est illisible plutôt que de deviner. Le mock gère ce
  chemin avec sa fixture.
- **6. Formulaire du profil** : vérification et correction du brouillon, validation par ProfileSchema, enregistrement (Profile,
  CvImport.profileId). Dates à l'année signalées ; summary écrit par l'utilisateur (éventuel bouton « Proposer un résumé » à relire).
  Liste des profils.
- **7. Génération de lettres (pipeline + UI)** : choisir un profil validé, coller le texte de l'offre ou son lien.
  Lien : texte de la page récupéré côté serveur ; en cas d'échec (LinkedIn, Indeed et d'autres bloquent souvent), message clair
  demandant de coller le texte. Montrer à l'utilisateur ce qui a été extrait de l'offre (poste, entreprise, compétences demandées)
  avant ou pendant la génération. Pipeline sur le profil seul (RAG à l'étape 9). Persistance Letter + table LlmCall (tokens par appel).
- **8. Design et export PDF** : templates de lettre designés (React/Tailwind, les mêmes pour l'aperçu et le PDF, une page),
  export via puppeteer-core + Edge.
- **9. RAG sur documents** : téléversement des documents du profil, découpage, recherche FTS5 branchée sur matchProfile,
  puis recherche hybride avec embeddings Gemini (fusion RRF).
- Plus tard : authentification.

## Stack
Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind, shadcn/ui, @anthropic-ai/sdk, @google/genai, Zod,
Prisma + libSQL (SQLite), unpdf, puppeteer-core (PDF).

## Environnement (important)
- Windows + PowerShell.
- Installer les paquets avec Bun, PAS npm (npm échoue sur les gros téléchargements sur cette machine) :
  & "$env:USERPROFILE\.bun\bin\bun.exe" add <paquet>
- N'installer un paquet qu'à l'étape où il sert. Pas de module natif à compiler (pas de Visual Studio sur la machine).
- Ne jamais modifier un fichier source avec Get-Content/Set-Content de PowerShell 5.1 : il lit l'UTF-8 sans BOM
  comme du Windows-1252 et corrompt les accents. Utiliser les outils d'édition de fichiers.
- Lancer le projet avec : npm run dev
- Tests : npm test (bun test, une base SQLite temporaire migrée, partagée par les fichiers de test).
  Test réel du provider configuré : npm run llm:smoke (appels payants, n'affiche jamais la clé).
- .env.local contient les clés API : ne jamais l'écraser, ne jamais le lire ni l'afficher. Variables : voir .env.example.
- PDF : puppeteer-core (PAS puppeteer, pas de Chrome téléchargé) avec Edge local, chemin dans CHROME_PATH (.env.local) :
  C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

## Base de données (Prisma 7 + libSQL)
- Prisma 7.10.1 (CLI, client et @prisma/adapter-libsql épinglés à la même version). Client généré dans lib/generated/prisma (gitignoré, `npm run db:generate`).
- Adaptateur libSQL (better-sqlite3 impossible : pas de Visual Studio pour compiler). URL : DATABASE_URL, sinon file:./prisma/dev.db (lib/db-url.ts).
- SQL brut dans les migrations : triggers document_owner_* et table FTS5 chunk_fts + triggers chunk_* (vérifiés par tests/migrations.test.ts).
  Les tables FTS5 sont déclarées `tables.external` dans prisma.config.ts, sinon migrate dev veut les supprimer.
  Une migration qui recrée Document ou Chunk supprime leurs triggers : les recréer dans la même migration.
- `prisma migrate dev` refuse de tourner en non-interactif dès qu'il y a un avertissement : utiliser --create-only, relire le SQL, puis appliquer.

## Profil
- Schéma : lib/schemas/profile.ts. ProfileSchema = profil validé (enregistré) ; ProfileTargetSchema = cible stricte de l'extraction ;
  ProfileDraftSchema = brouillon tolérant, complété dans le formulaire.
- Dates à la précision de la source : YYYY ou YYYY-MM (startDate : jusqu'à YYYY-MM-DD). Jamais de mois ou de jour inventé ;
  les dates à l'année sont signalées (isIncompleteDate, lib/cv/draft-warnings.ts). Pas de format "date" dans les schémas cibles :
  Gemini inventait alors le jour.
- Import du CV : /profiles/new → importCvAction → lib/cv/import.ts (texte via unpdf ou collé, extractProfile avec
  reasoning "low", CvImport persisté) → /profiles/import/[id]. summary rempli seulement si le CV a son propre résumé.
- Pages qui lisent la base (Cache Components) : lecture dans un composant sous <Suspense>, params lus dedans.

## LLM (lib/llm/)
- Point d'entrée : generateObject({ output, system, prompt, reasoning }) de lib/llm (server-only). Provider via LLM_PROVIDER
  (mock par défaut | anthropic | gemini), modèle via LLM_MODEL (obligatoire hors mock, JAMAIS de nom de modèle en dur).
  embed() viendra à l'étape 9.
- Les providers ne font que traduire ; validation Zod, relances (MAX_ATTEMPTS = 3 appels) et cumul des tokens
  sont dans lib/llm/generate.ts. Chaque appel renvoie usage (table LlmCall à l'étape 7).
- reasoning : "low" pour la recopie structurée (extraction de CV, analyse d'offre), plus élevé pour writeLetter et critique.
  Gemini : thinkingLevel (Gemini 3) ; Anthropic : output_config.effort.
- Sorties déclarées dans lib/schemas/llm-outputs.ts : `schema` = schéma cible STRICT envoyé au modèle (sans .catch(),
  .default() ni .transform(), qui rendraient le JSON Schema permissif) ; `lenientSchema` = schéma tolérant appliqué ensuite.
  Chaque sortie a une fixture mock lib/llm/fixtures/<name>.json (objet, ou liste servie par tentative).
- Anthropic : output_config.format (JSON Schema), PAS de tool_choice forcé (400 sur Opus 5.5 / Sonnet 5.5 / Fable 5.1),
  pas de temperature. Schéma adapté par sanitizeForAnthropic, pas par jsonSchemaOutputFormat du SDK (il perd les enums).
- Gemini : @google/genai, responseJsonSchema filtré par sanitizeForGemini (pas de pattern : décrire les formats avec .describe()).
  Les 429 ne sont pas retentés par le SDK : LLMRateLimitError avec message clair et délai (retryDelay).

## Pipeline de l'agent (lib/agent/)
analyzeOffer → matchProfile (profil ; + RAG à l'étape 9) → writeLetter → critique (puis réécriture) → rendu template.
Chaque étape = une fonction, sortie validée par un schéma Zod. Chaque argument de la lettre cite sa source (id du profil, puis chunk RAG).

## RAG (étape 9)
- Documents rattachés à un profil : descriptions de projets/README, rapports de stage, lettres de recommandation (sources de faits),
  anciennes lettres de motivation (type "style" : uniquement pour le ton, JAMAIS comme source de faits).
- Pages de l'entreprise ciblée : rattachées à une Letter, pas au profil.
- Recherche : SQLite FTS5, tokenizer `unicode61 remove_diacritics 2` (pas porter, documents FR et EN).
- Requête FTS5 toujours échappée (buildFtsQuery dans lib/rag/search.ts) : chaque terme entre guillemets doubles, joints par OR.
  search() accepte une chaîne ou une liste de termes (venant d'analyzeOffer). Par défaut, seuls les documents "fact" sont cherchés.
- Architecture prévue pour une recherche hybride BM25 + embeddings (fusion RRF), activable avec une clé Gemini
  (FTS5 seul ne relie pas une offre en anglais à des documents en français).
- Embeddings : recherche vectorielle native de libSQL (colonne F32_BLOB(dim) sur Chunk + index vectoriel, requête vector_top_k),
  ajoutée en SQL brut dans une migration quand le modèle d'embeddings (donc la dimension) sera choisi. Pas de champ embedding Bytes.
  vector_top_k renvoie le rowid : c'est pourquoi Chunk.id est un entier.

## Règles
- Ne jamais inventer une compétence ou expérience absente du profil validé (ni, à l'étape 9, des documents RAG sources de faits).
- Lettre d'une page max, en FR ou EN selon la langue de l'offre.
- Les templates de lettre sont des composants React/Tailwind, utilisés à la fois pour l'aperçu et le PDF.
- Clés API dans .env.local, jamais côté client.
- Avancer étape par étape : proposer un plan avant de coder chaque fonctionnalité.
- Un commit à la fin de chaque étape validée, message clair en anglais.
