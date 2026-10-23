@AGENTS.md

# Projet : LMAgent
Nom de l'app : « LMAgent » (L-M-Agent, pour « Lettre de Motivation Agent »), toujours écrit ainsi : jamais « LM AGENT »,
« LM Agent » ni « Imagent ». Constante APP_NAME dans components/logo.tsx.
App Next.js multi-utilisateur qui génère une lettre de motivation personnalisée par offre d'emploi, avec aperçu et export PDF designé.
Chaque utilisateur importe son CV (PDF, image ou texte), le LLM l'extrait vers le schéma Zod du profil, l'utilisateur vérifie/corrige
dans un formulaire, puis le profil est enregistré en base. Il choisit ensuite un profil validé, colle une offre (texte ou lien),
et l'agent produit une lettre spécifique à cette offre. Pas d'authentification pour l'instant.

## Feuille de route
Faites : 1. Fondations · 2. Schéma du profil · 3. Base (Prisma + libSQL, FTS5) · 4. Couche LLM · 5. Import du CV (PDF texte ou texte collé)
· 5b. CV en image (JPG, PNG, WebP redimensionnés par canvas dans le navigateur, aperçu, HEIC refusé avec message) et PDF scannés,
lus nativement par le modèle (prompt : omettre l'illisible). Pas d'option de lecture native pour les PDF texte (jugée inutile).

· 6. Formulaire du profil (vérification, avertissements, fusion projet → expérience, enregistrement lié à l'import, liste,
fiche, édition, suppression) et socle du design (jetons clair / sombre, polices, Lenis, apparitions CSS)
· 6b. Logo, accueil simple (3 étapes, « Commencer »), fiche du profil (complétude, parcours, compétences et leur usage)
· 7. Génération de lettres : offre collée ou lien (lecture serveur, repli sur le collage), pipeline reprenable, page de la
lettre (analyse, étapes animées, sources et surlignage à la demande), LlmCall, « Proposer un résumé ».

À faire, dans cet ordre (proposer le plan détaillé avant chaque étape) :
- **7. Génération de lettres (pipeline + UI)** : choisir un profil validé, coller le texte de l'offre ou son lien.
  Lien : texte de la page récupéré côté serveur ; en cas d'échec (LinkedIn, Indeed et d'autres bloquent souvent), message clair
  demandant de coller le texte. Montrer à l'utilisateur ce qui a été extrait de l'offre (poste, entreprise, compétences demandées)
  avant ou pendant la génération. Pipeline sur le profil seul (RAG à l'étape 9). Persistance Letter + table LlmCall (tokens par appel).
  Bouton « Proposer un résumé » (rédigé par le modèle à partir du profil, relu par l'utilisateur) dans le formulaire du profil.
- **8. Design et export PDF** : fait — 3 templates (Moderne par défaut, Classique et Compact au choix sur chaque lettre ;
  référence https://claude.ai/artifact/CBUj8Zqo38vCjGKP4XRCp1), export PDF, réduction automatique, « Modifier le texte »,
  accueil animé. Test réel via l'interface avec l'agent Cominty : fait (RAPPORT-COMINTY.md).
- **Plus tard** : bouton « Raccourcir la lettre » (réécriture par le modèle quand la lettre dépasse une page même à 10 pt).
- **9. RAG sur documents** : téléversement des documents du profil, découpage, recherche FTS5 branchée sur matchProfile,
  puis recherche hybride avec embeddings (fusion RRF) — fournisseur d'embeddings à choisir : toute l'IA doit passer par Cominty.
- Plus tard : authentification.

## Design et animations
- Logo : celui fourni par l'utilisateur (original : public/brand/lmagent-logo-original.jpg), redessiné en SVG dans
  components/logo.tsx (LogoMark, Logo en ligne, LogoStacked comme l'original) ; favicon app/icon.svg (version compacte).
  Le mot sous la marque est « LMAgent » (Public Sans grasse), pas « LM AGENT » comme sur l'image d'origine.
  Ne pas le remplacer par une autre piste : l'utilisateur veut CE logo. Dégradés SVG en userSpaceOnUse (un trait
  horizontal en objectBoundingBox ne s'affiche pas).
- Direction retenue : « Encre & papier » (référence : https://claude.ai/artifact/LdnhjcHWPiRgaNZYgzLwY8).
  Typographies : Instrument Serif (titres seulement), Public Sans (interface), Newsreader (lettre, aperçu et PDF).
  Jetons clair / sombre : fond #F5F6F9 / #10162A, surface #FFFFFF / #172036, encre #1C2A4A / #E7EAF3,
  accent (bouton) #1C2A4A / #C8D3F5, filet #D9DDE6 / #2A3452, mine #5F6880 / #9BA4BD, cachet (alertes) #B3261E / #EF6B62,
  surligneur #FFD9B5 / #F3C99F. En sombre, la lettre reste une feuille claire (#ECEEF3, texte #1C2A4A) : c'est le PDF.
- Écran de la lettre : apparition ligne par ligne (SplitText) ; « Voir les sources » (masquées par défaut, libellé lisible
  au survol, ex. « Stage Talan, 2025 », jamais l'id brut) ; « Surligner les compétences de l'offre » en option ;
  tokens et relances dans un détail repliable « Détails de la génération ». Sources, surlignage et détails : JAMAIS dans le PDF.
- GSAP (+ @gsap/react, hook useGSAP), Lenis (défilement doux), composants React Bits (copiés dans le projet).
- Apparitions discrètes des pages de travail en CSS (.reveal, .draw-tick dans globals.css), pas en GSAP : un gsap.from
  masque le contenu dès le départ et le laisse invisible si les images ne défilent pas (onglet en arrière-plan, headless).
  GSAP pour les séquences orchestrées (étapes de l'agent, lettre) et l'accueil. Thème : script dans <head> (lib/theme-script.ts)
  + ThemeToggle (Système / Clair / Sombre, localStorage) ; jetons dans app/globals.css.
- Animations marquées sur la page d'accueil seulement ; discrètes dans les pages de travail (import du CV, formulaire, génération).
  Génération : animation des étapes de l'agent, apparition progressive de la lettre.
- Lenis désactivé (data-lenis-prevent) sur les zones qui défilent : textarea, aperçu de la lettre, listes.
- Respecter prefers-reduced-motion (animations coupées ou réduites, Lenis désactivé).
- Pas de composants React Bits en WebGL (three.js, ogl) : seulement texte, cartes, boutons, fonds légers en CSS/SVG.
- Pas de `motion` (ex-Framer Motion) : seulement des composants React Bits en GSAP ou en CSS.
- Design final (inspiré de 21st.dev, référence https://claude.ai/artifact/4MK6T7bBc3vs7DfDqGrbZ7) : AUCUN code copié
  depuis 21st.dev, tout est réécrit en CSS / GSAP, sans `motion`. À conserver tel quel :
  en-tête collant flouté avec lien actif (components/nav-links.tsx, sous <Suspense> dans app/layout.tsx : usePathname
  bloque le prerender sinon) ; Stepper (components/stepper.tsx) sur /profiles/new et /profiles/import/[id] ;
  SpotlightCard (components/spotlight-card.tsx) sur les étapes de l'accueil ; accueil en deux colonnes avec pile de lettres ;
  import du CV en glisser-déposer avec .scan-line pendant l'analyse ; sommaire latéral collant (ProfileToc, scrollspy)
  et barre d'enregistrement collante dans le formulaire du profil ; anneau de complétude (conic-gradient) sur la fiche ;
  page de la lettre : étapes de l'agent en barre horizontale, barre d'outils unique (mise en page en contrôle segmenté +
  Sources / Surligner / Modifier le texte), barre d'export collante en bas (mots, sources, tokens, « Exporter en PDF »).
  Utilitaires CSS dans globals.css : .btn-shine (bouton principal), .spotlight, .scan-line, coupés en reduced motion.
- Design intégré au fil des étapes : socle (Lenis, reduced motion) et animations discrètes à l'étape 6, étapes de l'agent et
  apparition de la lettre à l'étape 7, animations marquées de l'accueil et templates de lettre à l'étape 8.

## Stack
Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind, shadcn/ui, agent managé Cominty (client REST maison,
lib/cominty), Zod, Prisma + libSQL (SQLite), unpdf, GSAP + @gsap/react, Lenis, puppeteer-core + pdf-lib (PDF).
Déploiement : Dockerfile + railway.json (volume /data pour SQLite, Chromium dans l'image).

## Environnement (important)
- Windows + PowerShell.
- Installer les paquets avec Bun, PAS npm (npm échoue sur les gros téléchargements sur cette machine) :
  & "$env:USERPROFILE\.bun\bin\bun.exe" add <paquet>
- N'installer un paquet qu'à l'étape où il sert. Pas de module natif à compiler (pas de Visual Studio sur la machine).
- Ne jamais modifier un fichier source avec Get-Content/Set-Content de PowerShell 5.1 : il lit l'UTF-8 sans BOM
  comme du Windows-1252 et corrompt les accents. Utiliser les outils d'édition de fichiers.
- Lancer le projet avec : npm run dev
- Tests : npm test (bun test, une base SQLite temporaire migrée, partagée par les fichiers de test).
  Test réel de l'agent : npm run cominty:smoke (UN appel, max_steps 3 ; n'affiche jamais la clé).
  NE JAMAIS lancer un appel réel à Cominty sans l'accord explicite de l'utilisateur : crédits payants.
  Vérifications : mode mock ($env:LLM_PROVIDER = "mock" pour le processus, sans toucher .env.local), base de démo
  temporaire (npm run demo:seed), jamais prisma/dev.db.
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
- Import du CV : /profiles/new → importCvAction → lib/cv/import.ts → /profiles/import/[id]. Type du fichier détecté par ses
  octets (lib/cv/file-type.ts). Texte collé ou PDF avec texte (unpdf) → readMode TEXT ; image ou PDF scanné → readMode NATIVE
  (fichier joint, attachments de generateObject). extractProfile en reasoning "low", CvImport persisté.
  summary rempli seulement si le CV a son propre résumé ; un stage ou un emploi va dans experiences, jamais dans projects.
- Pages qui lisent la base (Cache Components) : lecture dans un composant sous <Suspense>, params lus dedans, et
  `await io()` (next/cache) AVANT la requête : libSQL local répond pendant le prerender, sinon la page est figée au build.
- Formulaire du profil (étape 6) : app/profiles/_components/profile-form.tsx (react-hook-form 7.89 + @hookform/resolvers 5.9.1,
  versions épinglées). Valeurs = entrée de ProfileSchema, nettoyées par cleanProfileInput ("" → absent) avant validation,
  côté client ET serveur (saveProfileAction). Erreurs bloquantes = ProfileSchema ; avertissements = lib/profile/warnings.ts.
  Compétences d'expérience absentes des groupes ajoutées à « Autres compétences » (syncSkillsIntoGroups). Fusion projet →
  expérience : lib/profile/merge.ts. Libellés lisibles des éléments (sources de la lettre) : lib/profile/labels.ts.
  Brouillon local (localStorage) par import / profil. Import déjà relié à un profil → redirection vers son édition.
- Quasi-doublons de compétences (« Qdrant » / « recherche vectorielle (Qdrant) ») : lib/profile/skill-duplicates.ts,
  signalés dans la section Compétences et le récapitulatif ; fusion au choix de l'utilisateur (mergeSkills : une seule
  place par compétence, priorité au groupe thématique, « Autres compétences » en dernier).
- Lettres : suppression avec confirmation sur la page de la lettre (deleteLetterAction, LlmCall en cascade).
- Disponibilité : seul contractTypes est obligatoire. Réalisations : 0 minimum (avertissement). Messages Zod en français.

## LLM (lib/llm/) — étape 6 faite : Gemini, Anthropic et l'ancien pipeline en 5 étapes sont supprimés
- Point d'entrée : generateObject({ output, system, prompt }) de lib/llm (server-only), pour l'import du CV et « Proposer un
  résumé ». Provider via LLM_PROVIDER : mock (défaut, tests) | cominty (agent managé). Aucun autre provider.
- Validation Zod, relances (MAX_ATTEMPTS = 3, dans la MÊME conversation Cominty) et cumul tokens / coût : lib/llm/generate.ts.
- Sorties déclarées dans lib/schemas/llm-outputs.ts : `schema` = schéma cible STRICT envoyé au modèle (sans .catch(),
  .default() ni .transform()) ; `lenientSchema` = schéma tolérant appliqué ensuite. Fixture mock lib/llm/fixtures/<name>.json.
- Provider cominty (lib/llm/providers/cominty.ts) : message « LMAgent task: <nom> » avec consignes, RÈGLES DE PREUVE
  (lib/agent/evidence-rules.ts), JSON Schema et entrée ; JSON extrait même entouré de notes Markdown (lib/cominty/json.ts).

## Agent Cominty (exigence : toute l'IA passe par Cominty ; Gemini supprimé à l'étape 6)
- Branche de travail : `cominty` (ne pas pousser sur master/main sans accord). Agent managé déjà configuré sur
  platform.cominty.ai ; identifiants COMINTY_API_KEY, COMINTY_USER_ID, COMINTY_AGENT_ID dans .env.local (jamais lus ni affichés).
- Pas de SDK JS : client REST maison lib/cominty/ (d'après github.com/cominty/python-sdk) — POST /chat, POST /chat/{thread},
  flux GET /chat/messages/{id}/stream (application/jsonl, reprise avec last-event-id), annulation, fichiers. En-tête
  x-cominty-token, jamais envoyé au stockage des fichiers. Lignes de maintien (JSON non objet) ignorées.
- Instructions de l'agent (côté Cominty) : section « LMAgent mode » (message commençant par « LMAgent » : JSON analysis, score,
  scoreReasons, strengths, gaps, letter, cvAdjustments ; questions NATIVES de Cominty + {"status":"needs_input"} si une info
  manque) et « LMAgent task » (tâche JSON générique : extraction du CV, résumé). Pas d'option de schéma de sortie : JSON dans le texte.
- Lettre = UN tour d'agent (lib/letters/agent-run.ts) : AgentRun par message (START, ANSWER, CORRECTION), AgentEvent par étape
  (rejouée au rechargement), route SSE /letters/[id]/agent, une seule correction automatique par conversation si le JSON est
  invalide (lib/agent/agent-reply.ts : ids de sources autorisés + candidate-answers, noms d'exigences de l'analyse). La réponse
  remplit analysis / match / content / insights : retouches, PDF et checkLetter inchangés. Coût Cominty dans LlmCall.costUsd.
- Interface : étapes en direct (agent-timeline.tsx), questions en boutons (agent-questions.tsx ; « Autre… » ouvre un champ),
  Arrêter / Reprendre, score et ajustements du CV. Mention « CV envoyé à Cominty » sur la page d'import.
- Import du CV et résumé : provider `cominty` de lib/llm (LLM_PROVIDER=cominty), relances dans la même conversation.
- Protection des crédits (lib/cominty/guard.ts) : tout vrai appel exige le code d'accès (DEMO_ACCESS_CODE, page /acces,
  cookie = empreinte sha256 ; toujours exigé en production) ; plafond COMINTY_BUDGET_USD (3 $ par défaut) vérifié avant
  chaque message ; dépense = somme de ComintyCharge (une ligne par message facturé, via guardedClient). Client choisi par
  lib/cominty/agent-client.ts : d'après l'id du message (replay- / mock- / réel) ou, au démarrage, l'accès et la démo.
- Démo sans code : rejeu d'un vrai run enregistré (lib/demo/recorded-run.json, lib/cominty/replay-client.ts), même flux et
  même affichage, aucun appel ; nouvelle lettre à chaque clic. Avec le code : la dernière lettre de démo est réutilisée.
- Mock (défaut, tests, captures) : faux agent lib/cominty/mock-client.ts (une question puis la lettre). Test réel :
  npm run cominty:smoke (UN appel, max_steps 3) — TOUJOURS demander l'accord avant (crédits). max_steps par défaut : 3.

## Lettre par l'agent : règles métier (lib/agent/)
- Sources : catalogue du profil (lib/agent/sources.ts : ids des expériences, projets, formations + profile-summary,
  profile-availability, profile-skills, profile-languages) + candidate-answers (réponses aux questions de l'agent).
  Ids validés par un z.enum : l'agent ne peut pas citer une source inexistante (lib/agent/agent-reply.ts).
- Chaque message à l'agent contient le contrat JSON complet ET les règles de preuve : au test réel, l'agent a IGNORÉ la
  section « LMAgent mode » de ses instructions mais suit le format écrit dans le message.
- Lettre : 250 à 350 mots, une phrase = { text, sourceIds }. En-tête, lieu, date et signature construits par le code
  (lib/letters/view.ts), jamais par l'agent. Contact nommé dans l'offre : la lettre s'adresse à lui.
- Vérifications du code (lib/agent/letter-checks.ts) : longueur, langue, compétence absente revendiquée, contact ignoré ;
  résultat dans Letter.checks, affiché « Points à vérifier ».
- Offre par lien : lib/offer/fetch-offer.ts (JSON-LD JobPosting puis Readability + linkedom ; SSRF : adresses privées
  refusées aussi après redirection, ports 80/443, 10 s, 2 Mo). Échec → message et bascule sur « Coller le texte ».
- Pièges Cominty constatés : ids d'événements NON uniques (positions du flux : clé = id + étape + nom + phase, tri par
  correlation_id) ; POST /chat/{thread} renvoie le message, pas la conversation ; horodatages non monotones.

## Lettre : mise en page, retouches, PDF
- Templates : lib/letters/templates.ts (basePt) + components/letter/letter-document.tsx (un composant, aperçu ET PDF ;
  tailles en pt/mm, variable --letter-scale). Aperçu à l'échelle par zoom CSS (components/letter/sheet-fit.tsx).
- Retouches : lib/letters/stored.ts (applyEdits) — phrase inchangée = source gardée, phrase modifiée = sans source,
  edited: true (« modifiée par toi », ✎ quand les sources sont affichées). Letter.generated garde la version de l'agent.
- PDF : route GET /letters/[id]/pdf → lib/pdf/render.ts (puppeteer-core, Edge via CHROME_PATH, instance réutilisée)
  qui imprime /letters/[id]/print (feuille seule, média print, thème clair forcé). Réduction du texte par pas de 2 %
  jusqu'à 10 pt, puis export quand même avec avertissement (x-letter-overflow). AUCUN logo ni mention de LMAgent dans
  le PDF ; titre du PDF = objet de la lettre (title.absolute). Métadonnées neutralisées par pdf-lib 1.17.1
  (lib/pdf/metadata.ts : Creator et Producer vides, XMP retiré) : aucune trace de HeadlessChrome, Skia ni LMAgent.

## RAG (étape 9)
- Documents rattachés à un profil : descriptions de projets/README, rapports de stage, lettres de recommandation (sources de faits),
  anciennes lettres de motivation (type "style" : uniquement pour le ton, JAMAIS comme source de faits).
- Pages de l'entreprise ciblée : rattachées à une Letter, pas au profil.
- Recherche : SQLite FTS5, tokenizer `unicode61 remove_diacritics 2` (pas porter, documents FR et EN).
- Requête FTS5 toujours échappée (buildFtsQuery dans lib/rag/search.ts) : chaque terme entre guillemets doubles, joints par OR.
  search() accepte une chaîne ou une liste de termes (venant d'analyzeOffer). Par défaut, seuls les documents "fact" sont cherchés.
- Architecture prévue pour une recherche hybride BM25 + embeddings (fusion RRF), activable avec un fournisseur d'embeddings compatible avec l'exigence « tout par Cominty »
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
