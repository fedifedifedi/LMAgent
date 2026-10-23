# Rapport — intégration de l'agent Cominty (branche `cominty`)

Date : 23 octobre 2026. Toute l'IA de LMAgent passe désormais par l'agent managé Cominty (`LLM_PROVIDER=cominty`). Le
mock reste le mode par défaut, pour les tests et la démo locale.

Tests réels : uniquement avec le profil **fictif** Léa Dubois, sur une base temporaire. `prisma/dev.db` (tes vraies
données) n'a pas été utilisée, `.env.local` n'a pas été modifié, rien n'a été poussé sur `master`.

## 1. Ce qui marche

| Fonction | État | Vérifié |
|---|---|---|
| Lettre en un seul tour d'agent, étapes en direct, coût affiché | ✅ | réel, via l'interface |
| Validation du JSON de l'agent : sources autorisées, exigences de l'offre, vérifications du code | ✅ | réel + tests |
| Correction automatique unique si le JSON est invalide | ✅ | tests (mock) |
| Questions natives de Cominty en boutons, « Autre… » en champ libre | ✅ | réel (smoke test) + interface (mock) |
| Reprise après coupure du flux, rechargement de la page sans relancer l'agent | ✅ | tests (flux réel rejoué) |
| Arrêter / Reprendre | ✅ | tests (mock) |
| Import d'un CV PDF (texte) par l'agent | ✅ | réel, via l'interface |
| Export PDF de la lettre générée par l'agent | ✅ | réel (1 page, 11 pt) |
| Bouton « Essayer avec un profil de démo » | ✅ | interface (mock) |
| Configuration Railway (Dockerfile, railway.json, variables) | ⚠️ écrite, pas déployée | voir § 6 |

État final : **172 tests passent**, lint et typecheck propres, build de production OK.

## 2. La lettre obtenue au test réel

Offre fictive : stage de fin d'études Data scientist chez Hélio Prévisions (Bordeaux), contact M. Julien Roche.
Résultat : **260 mots, aucun point signalé par les vérifications du code, score 85/100**, Docker (demandé, absent du
profil) correctement listé en manque et jamais revendiqué. Généré en 2 min 21 s, du premier coup (sans question ni
correction). Entre crochets : les sources citées par l'agent, affichées avec « Sources ».

> **Candidature au stage de fin d'études — Data scientist — Hélio Prévisions**
>
> Monsieur Roche,
>
> Étudiante en deuxième année de master Data Science à l'Université de Bordeaux, je me permets de vous adresser ma
> candidature au poste de data scientist stagiaire chez Hélio Prévisions, pour une durée de six mois à compter de
> février 2027. *[Master Data Science ; Disponibilités]*
>
> La construction de modèles de prévision sur séries temporelles est au cœur de mes travaux récents. *[Projet tramway ;
> Stage Banque Atlantique]* Dans le cadre de mon master, j'ai développé un modèle de gradient boosting (LightGBM) pour
> prévoir la fréquentation horaire des stations de tramway à partir de données ouvertes, obtenant une erreur moyenne de
> 8 %. *[Projet tramway]* Ce projet m'a permis de maîtriser le cycle complet d'un modèle prédictif en Python, de la
> préparation des données à l'évaluation des performances. *[Projet tramway]*
>
> Lors de mon stage chez Banque Atlantique d'avril à août 2025, j'ai automatisé en SQL l'extraction mensuelle des
> données clients et construit des tableaux de bord Power BI utilisés au quotidien par quarante conseillers. *[Stage
> Banque Atlantique]* J'ai également entraîné un modèle de scoring de churn en Python avec scikit-learn, en améliorant
> la précision de 12 % par rapport au modèle existant. *[Stage Banque Atlantique]* Ces deux missions m'ont appris à
> travailler à la fois sur la robustesse des chaînes de données et sur la lisibilité des résultats pour des
> utilisateurs métier. *[Stage Banque Atlantique]*
>
> Hélio Prévisions s'inscrit dans un enjeu que je trouve particulièrement concret : aider les collectivités à piloter
> leur consommation d'énergie grâce aux données. L'échelle humaine de l'équipe, une vingtaine de personnes à Bordeaux,
> me permettrait de contribuer directement à des projets visibles dès les premières semaines.
>
> Je serais ravie de vous présenter mes travaux lors d'un entretien et reste disponible selon votre convenance.
> *[Disponibilités]*
>
> Dans l'attente de votre retour, je vous adresse mes sincères salutations.

En-tête (nom, coordonnées, destinataire, lieu et date) et signature : ajoutés par l'application, pas par l'agent.

**Points faibles relevés (à surveiller) :**
- « deuxième année de master » et « maîtriser le cycle complet d'un modèle » ne sont pas écrits dans le profil :
  petites inférences, pas des inventions de compétence, mais contraires à l'esprit « ne rien inventer ».
- La phrase sur les séries temporelles cite aussi le stage Banque Atlantique, qui n'en parle pas (sur-citation).

**Ajustements du CV proposés :** placer l'automatisation SQL en premier dans le stage Banque Atlantique ; mettre le
projet tramway en tête des projets avec « séries temporelles » et « LightGBM » dans le titre ; remonter ces deux
compétences dans la catégorie Machine learning ; ajouter « séries temporelles » au titre du profil.

**Import du CV au test réel** (`tests/fixtures/cv-sample.pdf`, CV fictif) : 21 s, une seule tentative, extraction
fidèle (« Data analyst (alternance) — Banque Atlantique — 2024 à aujourd'hui » → début `2024`, fin `null`, aucun mois
inventé ; compétences recopiées telles quelles).

## 3. Coût total

Budget fixé : 6 appels réels (≈ 1 $). **5 appels utilisés, ≈ 0,40 $.**

| # | Appel | Résultat | Coût |
|---|---|---|---|
| 1 | Lettre, 1er essai | réponse au mauvais format → bugs 1 à 3 | 0,100 $ |
| 2 | Correction automatique du n° 1 | jamais exécutée par Cominty (restée `pending`, client en erreur) | ≈ 0 $ |
| 3 | Lettre, 2e essai | ✅ lettre ci-dessus | 0,176 $ |
| 4 | Import du CV, 1er essai | profil correct mais entouré de notes Markdown → bug 5 | ≈ 0,06 $ (estimé, non enregistré) |
| 5 | Import du CV, 2e essai | ✅ profil extrait | 0,063 $ |

Pour mémoire, les deux appels du smoke test d'avant ta pause : 0,123 $ + 0,059 $.
Lectures sans coût utilisées pour diagnostiquer : relecture du flux d'un message terminé, liste des conversations.

## 4. Bugs trouvés pendant les tests réels et corrigés (un commit chacun)

| Commit | Bug | Correction |
|---|---|---|
| `c243fda` | `POST /chat/{thread}` renvoie le **message**, pas la conversation : la correction automatique plantait | le client lit le message renvoyé |
| `df1c99e` | l'agent **ignore la section « LMAgent mode »** de ses instructions : clés snake_case, lettre en un bloc avec date, adresse et signature | le contrat JSON complet est envoyé dans chaque message (départ, réponses, correction) ; champs facultatifs vides tolérés ; réponse réelle gardée comme fixture de test |
| `caf9c45` | après une erreur, la lettre restait « en cours » sans exécution : **la page aurait relancé l'agent toute seule** (crédits) et affichait une erreur Zod brute | lettre en échec reprenable, message lisible, début de la réponse gardé pour diagnostic |
| `4b2619f` | la 1re étape restait en chargement : les **ids d'événements Cominty ne sont pas uniques** (positions dans le flux) | événements identifiés par id + étape + nom + phase, triés par étape |
| `d643ea9` | **JSON suivi de notes Markdown** (« Extraction notes », tableau) non lu à l'import du CV | extraction du premier bloc de code ou du premier objet JSON équilibré ; erreurs illisibles du client traduites |

Ajouts : `0190f33` bouton de démo, `46fc648` préparation Railway.

## 5. Bouton « Essayer avec un profil de démo »

Sur l'accueil, à côté de « Commencer ». Il crée (ou réutilise) le profil fictif « Léa Dubois (démo) » et sa dernière
lettre, puis l'ouvre : **un clic répété ne relance jamais l'agent**, seule la première visite génère la lettre.
`DEMO_ENABLED=0` le masque.

## 6. Déploiement Railway : prêt, à faire de ton côté

Fichiers : `Dockerfile` (Node 22, Bun 1.4.3, Chromium pour le PDF, migrations au démarrage), `railway.json`,
`.dockerignore` (jamais de `.env*` ni de base dans l'image), `.env.example` (toutes les variables, sans valeur), section
« Déploiement sur Railway » du README.

Étapes : déployer la branche `cominty` → ajouter un **volume monté sur `/data`** (base SQLite) → saisir
`LLM_PROVIDER=cominty` et les trois `COMINTY_*` dans les variables Railway → générer un domaine.

⚠️ **Non vérifié** : l'image n'a pas été construite localement (Docker Desktop installé mais arrêté ; je ne l'ai pas
démarré sans ton accord) et rien n'a été déployé (il faut ton compte Railway). Commande pour tester :
`docker build -t lmagent .` puis `docker run -p 3000:3000 -v lmagent-data:/data -e LLM_PROVIDER=mock lmagent`.

⚠️ **Sécurité** : pas d'authentification. Une URL publique permet à n'importe qui d'importer un CV et de lancer l'agent
sur tes crédits. Garde l'URL privée, ou déploie en `LLM_PROVIDER=mock` pour une démo publique.

## 7. Ce qui reste à faire

1. **Étape 6** : supprimer Gemini (provider, `@google/genai`, `sanitizeForGemini`, message de quota Gemini) et l'ancien
   pipeline en 5 étapes, garder le mock ; mettre à jour CLAUDE.md et le README.
2. **Instructions de l'agent** : comme il suit le format du message plutôt que sa section, tu peux simplifier les
   sections « LMAgent mode » / « LMAgent task » ; y ajouter « ne déduis jamais l'année d'études, une durée ou une
   compétence qui n'est pas écrite » (cf. inférences ci-dessus).
3. **Non testé en réel** : CV en image ou PDF scanné (envoi de fichier `uploadFile`), réponse aux questions natives
   via l'interface (seul le smoke test a vu une question réelle), bouton « Proposer un résumé ».
4. **Durée** : 2 à 3 minutes par lettre, avec peu d'étapes intermédiaires envoyées par Cominty (mise en route,
   réflexion, réponse) : la frise est juste mais peu animée. Piste : messages intermédiaires de l'agent, si Cominty
   le permet.
5. Construire et tester l'image Docker, puis déployer sur Railway ; ajouter une protection d'accès avant toute URL
   publique.
6. Pousser la branche `cominty` (fait à chaque étape validée ; les derniers commits sont à pousser) et, quand tu le
   décides, ouvrir une pull request vers `master`.
