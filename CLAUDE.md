@AGENTS.md

# Projet : LMAgent
App Next.js multi-utilisateur qui génère une lettre de motivation personnalisée par offre d'emploi, avec aperçu et export PDF designé.
Chaque utilisateur importe son CV (PDF ou texte), le LLM l'extrait vers le schéma Zod du profil, l'utilisateur vérifie/corrige
dans un formulaire, puis le profil est enregistré en base avec ses lettres et ses documents RAG. Pas d'authentification pour l'instant.

## Stack
Next.js 16 (App Router), TypeScript strict, Tailwind, shadcn/ui, @anthropic-ai/sdk, Zod, Prisma + SQLite, puppeteer-core (PDF).

## Environnement (important)
- Windows + PowerShell.
- Installer les paquets avec Bun, PAS npm (npm échoue sur les gros téléchargements sur cette machine) :
  & "$env:USERPROFILE\.bun\bin\bun.exe" add <paquet>
- N'installer un paquet qu'à l'étape où il sert.
- Lancer le projet avec : npm run dev
- Tests : npm test (bun test, base SQLite temporaire avec les migrations appliquées).

## Base de données (Prisma 7 + libSQL)
- Prisma 7.10.1 (CLI, client et @prisma/adapter-libsql épinglés à la même version). Client généré dans lib/generated/prisma (gitignoré, `npm run db:generate`).
- Adaptateur libSQL (better-sqlite3 impossible : pas de Visual Studio pour compiler). URL : DATABASE_URL, sinon file:./prisma/dev.db (lib/db-url.ts).
- SQL brut dans les migrations : triggers document_owner_* et table FTS5 chunk_fts + triggers chunk_*.
  Les tables FTS5 sont déclarées `tables.external` dans prisma.config.ts, sinon migrate dev veut les supprimer.
  Une migration qui recrée Document ou Chunk supprime leurs triggers : les recréer dans la même migration.
- `prisma migrate dev` refuse de tourner en non-interactif dès qu'il y a un avertissement : utiliser --create-only, relire le SQL, puis appliquer.
- .env.local contient la clé API : ne jamais l'écraser.
- PDF : puppeteer-core (PAS puppeteer, pas de Chrome téléchargé) avec Edge local, chemin dans CHROME_PATH (.env.local) :
  C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

## Profil
- Schéma : lib/schemas/profile.ts. ProfileSchema = profil validé (enregistré) ; ProfileDraftSchema = sortie tolérante de l'extraction, complétée dans le formulaire.

## LLM (lib/llm/)
Interface LLMProvider (generateObject avec schéma Zod, embed) : implémentations mock (par défaut), anthropic, gemini,
choisie via LLM_PROVIDER dans .env.local. Le mock doit permettre de tout faire tourner sans clé API.

## RAG
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

## Pipeline de l'agent (lib/agent/)
analyzeOffer → matchProfile (+ RAG) → writeLetter → critique (puis réécriture) → rendu template.
Chaque étape = une fonction, sortie validée par un schéma Zod. Chaque argument de la lettre cite sa source (id du profil ou chunk RAG).

## Règles
- Ne jamais inventer une compétence ou expérience absente du profil validé ou des documents RAG sources de faits.
- Lettre d'une page max, en FR ou EN selon la langue de l'offre.
- Les templates de lettre sont des composants React/Tailwind, utilisés à la fois pour l'aperçu et le PDF.
- Clé API dans .env.local, jamais côté client.
- Avancer étape par étape : proposer un plan avant de coder chaque fonctionnalité.
- Un commit à la fin de chaque étape validée, message clair en anglais.
